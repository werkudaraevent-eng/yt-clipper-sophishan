from uuid import uuid4

from clipper_worker.queue import JobQueue

from .test_queue_position import _position


def _buyer(conn, make_user, status="paid"):
    uid = make_user()
    conn.execute(
        "insert into public.credit_orders "
        "(user_id, pack_id, credits, amount, invoice_number, status) "
        "values (%s, 'p300', 300, 149000, %s, %s)",
        (uid, f"INV-{uuid4().hex[:10]}", status),
    )
    return uid


def _line(conn, make_project, owners):
    """One queued project per owner, created a minute apart in this order."""
    projects = []
    for i, owner in enumerate(owners):
        pid = make_project(owner)
        conn.execute(
            "update public.jobs set run_after = now() - make_interval(mins => %s) "
            "where project_id = %s",
            (len(owners) - i, pid),
        )
        projects.append(pid)
    return projects


def _claim_order(conn, n):
    queue = JobQueue(conn, "w-a")
    order = []
    for _ in range(n):
        job = queue.claim()
        order.append(job.project_id)
        conn.execute(
            "update public.jobs set status = 'succeeded', finished_at = now() where id = %s",
            (job.id,),
        )
        # Claims in one transaction share now(); keep their start times apart.
        conn.execute(
            "update public.jobs set started_at = started_at + make_interval(secs => %s) "
            "where id = %s",
            (len(order), job.id),
        )
    return order


def test_buyers_go_first_but_every_third_claim_is_free(conn, make_project, make_user):
    free = [make_user() for _ in range(3)]
    paid = [_buyer(conn, make_user) for _ in range(4)]
    # Free users queued first; buyers came later.
    projects = _line(conn, make_project, free + paid)
    f1, f2, f3, p1, p2, p3, p4 = projects
    assert _claim_order(conn, 7) == [p1, p2, f1, p3, p4, f2, f3]


def test_an_empty_lane_never_holds_a_worker_back(conn, make_project, make_user):
    f1, f2, f3 = _line(conn, make_project, [make_user() for _ in range(3)])
    assert _claim_order(conn, 3) == [f1, f2, f3]


def test_unpaid_orders_do_not_count(conn, make_project, make_user):
    first, late = _line(conn, make_project, [make_user(), _buyer(conn, make_user, "pending")])
    assert _claim_order(conn, 2) == [first, late]


def test_position_follows_the_lanes(conn, make_project, make_user):
    free = [make_user() for _ in range(4)]
    paid = [_buyer(conn, make_user) for _ in range(3)]
    projects = _line(conn, make_project, free + paid)
    f4, p3 = projects[3], projects[-1]

    pos = _position(conn, paid[-1], p3)
    # Two buyers ahead and one free job slotted between them.
    assert (pos["place"], pos["priority"]) == (4, True)

    pos = _position(conn, free[-1], f4)
    # Three free jobs ahead; all three buyers fit in before this one.
    assert (pos["place"], pos["priority"]) == (7, False)
