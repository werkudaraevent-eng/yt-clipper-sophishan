import uuid

from tests.test_credit_orders import _balance
from tests.test_pricing_admin import _call, _invite_code, _settings


def _signup(conn, email):
    uid = uuid.uuid4()
    conn.execute("insert into auth.users (id, email) values (%s, %s)", (uid, email))
    return uid


def test_one_gmail_inbox_gets_free_credits_once(conn):
    first = _signup(conn, "Nama.Saya@gmail.com")
    aliases = [
        _signup(conn, "namasaya+1@gmail.com"),
        _signup(conn, "n.a.m.a.s.a.y.a@googlemail.com"),
        _signup(conn, "NAMASAYA+clip@GMAIL.com"),
    ]
    assert _balance(conn, first) == 30
    assert [_balance(conn, uid) for uid in aliases] == [0, 0, 0]
    rows = conn.execute(
        "select count(*) as n from public.credit_ledger where user_id = any(%s)", (aliases,)
    ).fetchone()
    assert rows["n"] == 0


def test_other_domains_drop_the_tag_but_keep_dots(conn):
    assert _balance(conn, _signup(conn, "budi@kantor.co.id")) == 30
    assert _balance(conn, _signup(conn, "budi+2@kantor.co.id")) == 0
    assert _balance(conn, _signup(conn, "b.udi@kantor.co.id")) == 30


def test_throwaway_mail_gets_no_free_credits(conn):
    assert _balance(conn, _signup(conn, "siapa@mailinator.com")) == 0
    assert _balance(conn, _signup(conn, "siapa@yopmail.com")) == 0


def test_deleting_the_account_does_not_grant_again(conn):
    first = _signup(conn, "ulang@gmail.com")
    conn.execute("delete from auth.users where id = %s", (first,))
    assert _balance(conn, _signup(conn, "ulang@gmail.com")) == 0


def test_alias_accounts_get_no_referral_bonus(conn, make_user):
    _settings(conn, referral_enabled=True, referral_signup_bonus=10)
    inviter = make_user("inviter@example.com")
    code = _invite_code(conn, inviter)["code"]
    _signup(conn, "teman@gmail.com")
    alias = _signup(conn, "teman+2@gmail.com")
    assert not _call(conn, alias, "select public.claim_referral(%s) as ok", code)["ok"]
    assert _balance(conn, alias) == 0
