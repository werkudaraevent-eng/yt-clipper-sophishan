import json
import re

import psycopg
import pytest

from tests.test_credit_orders import _balance, _settle, payments_token  # noqa: F401


@pytest.fixture(autouse=True)
def _reset_pricing(conn):
    yield
    conn.execute("update public.credit_orders set promo_code_id = null")
    conn.execute("delete from public.promo_codes")
    conn.execute(
        "update public.pricing_settings set signup_credits = 30, discount_until = null, "
        "referral_enabled = false, referral_reward = 30, referral_signup_bonus = 0"
    )
    conn.execute("delete from public.credit_packs where id not in ('p30', 'p100', 'p300', 'p1000')")
    conn.execute(
        "update public.credit_packs set discount_percent = 0, active = true, "
        "featured = (id = 'p300'), "
        "price_idr = case id when 'p30' then 19000 when 'p100' then 59000 "
        "when 'p300' then 149000 else 399000 end"
    )


def _call(conn, uid, sql, *args):
    conn.execute("set role authenticated")
    conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    try:
        return conn.execute(sql, args).fetchone()
    finally:
        conn.execute("reset role")


def _owner(conn, make_user):
    uid = make_user("owner@example.com")
    conn.execute("update public.profiles set role = 'owner' where id = %s", (uid,))
    return uid


def _settings(conn, **values):
    sets = ", ".join(f"{k} = %s" for k in values)
    conn.execute(f"update public.pricing_settings set {sets}", tuple(values.values()))


def _order(conn, uid, pack="p300", promo=None):
    return _call(conn, uid, "select * from public.create_credit_order(%s, %s)", pack, promo)


def _promo(conn, owner, **fields):
    data = {"code": "HEMAT20", "kind": "percent", "value": 20, **fields}
    return _call(conn, owner, "select public.admin_save_promo(%s) as id", json.dumps(data))["id"]


def test_new_accounts_get_the_configured_signup_credits(conn, make_user):
    _settings(conn, signup_credits=50)
    uid = make_user()
    assert _balance(conn, uid) == 50
    _settings(conn, signup_credits=0)
    nothing = make_user()
    assert _balance(conn, nothing) == 0
    rows = conn.execute(
        "select count(*) as n from public.credit_ledger where user_id = %s", (nothing,)
    ).fetchone()
    assert rows["n"] == 0


def test_pack_discount_applies_until_it_ends(conn, make_user):
    conn.execute("update public.credit_packs set discount_percent = 20 where id = 'p300'")
    uid = make_user()
    order = _order(conn, uid)
    assert (order["amount"], order["list_amount"]) == (119200, 149000)
    _settings(conn, discount_until="2000-01-01T00:00:00Z")
    assert _order(conn, uid)["amount"] == 149000


def test_owner_saves_packs_and_admins_cannot(conn, make_user):
    owner = _owner(conn, make_user)
    admin = make_user("admin@example.com")
    conn.execute("update public.profiles set role = 'admin' where id = %s", (admin,))
    packs = [
        {"id": "p30", "credits": 30, "price_idr": 19000, "featured": False, "active": True},
        {
            "id": "p300",
            "credits": 300,
            "price_idr": 139000,
            "discount_percent": 10,
            "featured": True,
        },
        {"credits": 50, "price_idr": 29000, "featured": False, "active": True},
    ]
    with pytest.raises(psycopg.errors.InsufficientPrivilege, match="not_owner"):
        _call(conn, admin, "select public.admin_save_pricing(%s, null)", json.dumps(packs))
    _call(
        conn,
        owner,
        "select public.admin_save_pricing(%s, %s)",
        json.dumps(packs),
        json.dumps({"signup_credits": 40, "referral_enabled": True}),
    )
    data = _call(conn, admin, "select public.admin_pricing() as d")["d"]
    by_credits = {p["credits"]: p for p in data["packs"]}
    assert by_credits[300]["price_idr"] == 139000
    assert by_credits[300]["discount_percent"] == 10
    assert by_credits[50]["sort_order"] == 3
    assert data["settings"]["signup_credits"] == 40
    assert data["settings"]["referral_enabled"] is True


def test_save_refuses_two_featured_packs_and_prices_below_1000(conn, make_user):
    owner = _owner(conn, make_user)
    two = [{"id": "p30", "credits": 30, "price_idr": 19000, "featured": True}]
    with pytest.raises(psycopg.errors.InvalidParameterValue, match="one_featured"):
        _call(conn, owner, "select public.admin_save_pricing(%s, null)", json.dumps(two))
    cheap = [{"id": "p30", "credits": 30, "price_idr": 900}]
    with pytest.raises(psycopg.errors.InvalidParameterValue, match="price_too_low"):
        _call(conn, owner, "select public.admin_save_pricing(%s, null)", json.dumps(cheap))


def test_hidden_packs_cannot_be_bought(conn, make_user):
    conn.execute("update public.credit_packs set active = false where id = 'p30'")
    with pytest.raises(psycopg.errors.RaiseException, match="unknown_pack"):
        _order(conn, make_user(), "p30")


def test_promo_code_lowers_the_price_and_counts_its_uses(conn, make_user, payments_token):  # noqa: F811
    owner = _owner(conn, make_user)
    _promo(conn, owner, max_uses=1)
    alice, bob = make_user("alice@example.com"), make_user("bob@example.com")
    order = _order(conn, alice, "p300", " hemat20 ")
    assert order["amount"] == 119200
    assert order["promo_code_id"] is not None
    with pytest.raises(psycopg.errors.RaiseException, match="promo_already_used"):
        _order(conn, alice, "p300", "HEMAT20")
    with pytest.raises(psycopg.errors.RaiseException, match="promo_used_up"):
        _order(conn, bob, "p300", "HEMAT20")
    assert _settle(conn, order["invoice_number"], "SUCCESS", 119200) == "paid"
    data = _call(conn, owner, "select public.admin_pricing() as d")["d"]
    assert data["promos"][0]["uses"] == 1


def test_promo_code_rules(conn, make_user):
    owner = _owner(conn, make_user)
    _promo(conn, owner, code="BIG", kind="amount", value=50000, pack_id="p1000")
    _promo(conn, owner, code="OLD", expires_at="2000-01-01T00:00:00Z")
    _promo(conn, owner, code="HUGE", kind="amount", value=18500)
    uid = make_user()
    for code, error in [
        ("NOPE", "promo_not_found"),
        ("OLD", "promo_expired"),
        ("BIG", "promo_wrong_pack"),
    ]:
        with pytest.raises(psycopg.errors.RaiseException, match=error):
            _order(conn, uid, "p300", code)
    with pytest.raises(psycopg.errors.RaiseException, match="promo_too_big"):
        _order(conn, uid, "p30", "HUGE")
    assert _order(conn, uid, "p1000", "BIG")["amount"] == 349000


def test_codes_do_not_stack_with_pack_discounts(conn, make_user):
    owner = _owner(conn, make_user)
    _promo(conn, owner, code="SMALL", value=10)
    conn.execute("update public.credit_packs set discount_percent = 20 where id = 'p300'")
    uid = make_user()
    quote = _call(conn, uid, "select public.quote_credit_order('p300', 'SMALL') as q")["q"]
    assert quote["amount"] == 119200
    assert quote["promo_applied"] is False
    order = _order(conn, uid, "p300", "SMALL")
    assert (order["amount"], order["promo_code_id"]) == (119200, None)


def test_promo_codes_are_not_readable(conn, make_user):
    owner = _owner(conn, make_user)
    _promo(conn, owner)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        _call(conn, make_user(), "select * from public.promo_codes")


def _invite_code(conn, uid):
    return _call(conn, uid, "select public.my_referral() as r")["r"]


def test_referral_rewards_the_inviter_once_after_the_first_purchase(
    conn,
    make_user,
    payments_token,  # noqa: F811
):
    _settings(conn, referral_enabled=True, referral_reward=30, referral_signup_bonus=10)
    inviter = make_user("inviter@example.com")
    code = _invite_code(conn, inviter)["code"]
    friend = make_user("friend@example.com")
    start_inviter, start_friend = _balance(conn, inviter), _balance(conn, friend)

    assert _call(conn, friend, "select public.claim_referral(%s) as ok", code.upper())["ok"]
    assert not _call(conn, friend, "select public.claim_referral(%s) as ok", code)["ok"]
    assert not _call(conn, inviter, "select public.claim_referral(%s) as ok", code)["ok"]
    assert _balance(conn, friend) == start_friend + 10

    first = _order(conn, friend, "p30")
    second = _order(conn, friend, "p30")
    assert _settle(conn, first["invoice_number"], "SUCCESS", 19000) == "paid"
    assert _settle(conn, second["invoice_number"], "SUCCESS", 19000) == "paid"
    assert _balance(conn, inviter) == start_inviter + 30
    stats = _invite_code(conn, inviter)
    assert (stats["invited"], stats["bought"], stats["earned"]) == (1, 1, 30)


def test_referral_needs_the_program_on_and_a_new_account(conn, make_user):
    inviter = make_user("inviter@example.com")
    friend = make_user("friend@example.com")
    assert _invite_code(conn, inviter) == {"enabled": False}
    _settings(conn, referral_enabled=True)
    code = _invite_code(conn, inviter)["code"]
    conn.execute(
        "update public.profiles set created_at = now() - interval '2 days' where id = %s",
        (friend,),
    )
    assert not _call(conn, friend, "select public.claim_referral(%s) as ok", code)["ok"]


def _unguarded_writes(conn):
    """UPDATE or DELETE statements with no WHERE clause in the API's functions."""
    rows = conn.execute(
        "select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
        "where n.nspname in ('public', 'private') and p.prolang in "
        "(select oid from pg_language where lanname in ('plpgsql', 'sql'))"
    ).fetchall()
    found = []
    for row in rows:
        source = re.sub(r"--[^\n]*", "", row["prosrc"])
        for statement in source.split(";"):
            match = re.search(r"\b(update\s+[\w.]+\s+set|delete\s+from)\b", statement, re.I)
            if match and not re.search(r"\bwhere\b", statement[match.start() :], re.I):
                found.append(f"{row['proname']}: {' '.join(statement.split())[:80]}")
    return found


def test_functions_never_update_or_delete_without_where(conn):
    # Supabase loads pg-safeupdate for API sessions: such a statement fails there
    # (even in a security definer function) while it passes in this test database.
    assert _unguarded_writes(conn) == []
