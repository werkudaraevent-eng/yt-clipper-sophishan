import psycopg
import pytest

TOKEN = "test-payments-token"


def _as(conn, uid):
    conn.execute("set role authenticated")
    conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid),))


@pytest.fixture
def payments_token(conn):
    conn.execute(
        "insert into private.settings (key, value) "
        "values ('payments_token_sha256', encode(extensions.digest(%s, 'sha256'), 'hex')) "
        "on conflict (key) do update set value = excluded.value",
        (TOKEN,),
    )
    return TOKEN


def _order(conn, uid, pack="p300"):
    _as(conn, uid)
    try:
        return conn.execute("select * from public.create_credit_order(%s)", (pack,)).fetchone()
    finally:
        conn.execute("reset role")


def _settle(conn, invoice, status, amount, token=TOKEN, channel="QRIS"):
    conn.execute("set role anon")
    try:
        return conn.execute(
            "select public.settle_credit_order(%s, %s, %s, %s, %s) as s",
            (token, invoice, status, channel, amount),
        ).fetchone()["s"]
    finally:
        conn.execute("reset role")


def _balance(conn, uid):
    return conn.execute(
        "select credits_remaining as c from public.profiles where id = %s", (uid,)
    ).fetchone()["c"]


def test_order_takes_the_price_from_the_pack(conn, make_user):
    order = _order(conn, make_user())
    assert (order["credits"], order["amount"], order["status"]) == (300, 149000, "pending")
    assert order["invoice_number"].startswith("SOF-")


def test_unknown_pack_and_signed_out_users_are_refused(conn, make_user):
    with pytest.raises(psycopg.errors.RaiseException, match="unknown_pack"):
        _order(conn, make_user(), "p999")
    conn.execute("set role anon")
    try:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("select public.create_credit_order('p30')")
    finally:
        conn.execute("reset role")


def test_payment_page_must_be_doku(conn, make_user):
    uid = make_user()
    order = _order(conn, uid)
    _as(conn, uid)
    try:
        with pytest.raises(psycopg.errors.RaiseException, match="bad_payment_url"):
            conn.execute(
                "select public.attach_credit_order_payment(%s, 'https://evil.example/pay', null)",
                (order["id"],),
            )
        conn.execute(
            "select public.attach_credit_order_payment(%s, %s, null)",
            (order["id"], "https://sandbox.doku.com/checkout-link-v2/abc"),
        )
    finally:
        conn.execute("reset role")
    url = conn.execute(
        "select payment_url from public.credit_orders where id = %s", (order["id"],)
    ).fetchone()["payment_url"]
    assert url == "https://sandbox.doku.com/checkout-link-v2/abc"


def test_success_adds_credits_once(conn, make_user, payments_token):
    uid = make_user()
    start = _balance(conn, uid)
    order = _order(conn, uid)
    assert _settle(conn, order["invoice_number"], "SUCCESS", 149000) == "paid"
    assert _settle(conn, order["invoice_number"], "SUCCESS", 149000) == "paid"
    assert _settle(conn, order["invoice_number"], "FAILED", 149000) == "paid"
    assert _balance(conn, uid) == start + 300
    rows = conn.execute(
        "select delta, reason, order_id from public.credit_ledger "
        "where user_id = %s and reason = 'purchase'",
        (uid,),
    ).fetchall()
    assert rows == [{"delta": 300, "reason": "purchase", "order_id": order["id"]}]
    paid = conn.execute(
        "select status, channel, valid_until > now() + interval '11 months' as valid "
        "from public.credit_orders where id = %s",
        (order["id"],),
    ).fetchone()
    assert paid == {"status": "paid", "channel": "QRIS", "valid": True}


def test_settling_needs_the_token_and_the_right_amount(conn, make_user, payments_token):
    uid = make_user()
    order = _order(conn, uid)
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="forbidden"):
        _settle(conn, order["invoice_number"], "SUCCESS", 149000, token="wrong")
    with pytest.raises(psycopg.errors.RaiseException, match="amount_mismatch"):
        _settle(conn, order["invoice_number"], "SUCCESS", 1000)
    assert _settle(conn, "SOF-000000-NOPE", "SUCCESS", 149000) == "not_found"


def test_failure_closes_a_pending_order_but_a_late_payment_still_counts(
    conn, make_user, payments_token
):
    uid = make_user()
    start = _balance(conn, uid)
    order = _order(conn, uid, "p30")
    assert _settle(conn, order["invoice_number"], "EXPIRED", None, channel=None) == "expired"
    assert _balance(conn, uid) == start
    # Money that arrives after all is still owed.
    assert _settle(conn, order["invoice_number"], "SUCCESS", 19000) == "paid"
    assert _balance(conn, uid) == start + 30


def test_users_only_see_and_cancel_their_own_orders(conn, make_user):
    alice, bob = make_user("alice@example.com"), make_user("bob@example.com")
    order = _order(conn, alice)
    _as(conn, bob)
    try:
        assert conn.execute("select count(*) as n from public.credit_orders").fetchone()["n"] == 0
        conn.execute("select public.cancel_credit_order(%s)", (order["id"],))
    finally:
        conn.execute("reset role")
    status = conn.execute(
        "select status from public.credit_orders where id = %s", (order["id"],)
    ).fetchone()["status"]
    assert status == "pending"
    _as(conn, alice)
    try:
        conn.execute("select public.cancel_credit_order(%s)", (order["id"],))
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("select * from private.settings")
    finally:
        conn.execute("reset role")
    status = conn.execute(
        "select status from public.credit_orders where id = %s", (order["id"],)
    ).fetchone()["status"]
    assert status == "cancelled"
