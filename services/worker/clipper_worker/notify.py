"""Email the owner when a project is done ("Kabari saya saat klip siap").

Sent through Resend's HTTP API. Without RESEND_API_KEY nothing is sent, but
projects are still marked as notified so turning the key on later does not
mail old projects. A failed send is logged and never fails the job.
"""

import logging
import os
from dataclasses import dataclass
from html import escape
from typing import TYPE_CHECKING
from uuid import UUID

import httpx

if TYPE_CHECKING:
    from .queue import JobQueue
    from .storage import ClipStorage

log = logging.getLogger("clipper_worker")

RESEND_URL = "https://api.resend.com/emails"
# Long enough for a user who opens the email the next day.
THUMB_URL_SECONDS = 7 * 24 * 60 * 60
THUMBS = 3

PRIMARY = "#006859"
ON_SURFACE = "#171d1b"
ON_SURFACE_VARIANT = "#3d4946"
SURFACE_CONTAINER = "#e9efec"
SURFACE_HIGHEST = "#dee4e0"
OUTLINE_VARIANT = "#bccac4"

TEXT = {
    "id": {
        "untitled": "project kamu",
        "ready_subject": 'Klip dari "{title}" sudah siap',
        "ready_heading": "{n} klip dari {title} sudah siap",
        "ready_heading_empty": "{title} sudah selesai diproses",
        "ready_body": "Klip kamu sudah selesai diproses. Buka untuk mengunduh atau langsung "
        "posting ke YouTube.",
        "ready_button": "Lihat {n} klip",
        "failed_subject": 'Klip dari "{title}" gagal dibuat',
        "failed_heading": "{title} gagal diproses",
        "failed_body": "Maaf, project ini gagal diproses. Kredit yang terpakai sudah "
        "dikembalikan ke saldo kamu.",
        "open_button": "Buka project",
        "footer": 'Kamu menerima email ini karena menyalakan "Kabari saya saat klip siap" '
        "di sofish.tech. Matikan lewat sakelar itu di halaman project.",
    },
    "en": {
        "untitled": "your project",
        "ready_subject": 'Clips from "{title}" are ready',
        "ready_heading": "{n} clips from {title} are ready",
        "ready_heading_empty": "{title} is done",
        "ready_body": "Your clips are done. Open them to download or post straight to YouTube.",
        "ready_button": "View {n} clips",
        "failed_subject": 'Clips from "{title}" could not be made',
        "failed_heading": "{title} failed",
        "failed_body": "Sorry, this project failed. The credits it used are back in your balance.",
        "open_button": "Open project",
        "footer": 'You get this email because "Notify me when clips are ready" is on at '
        "sofish.tech. Turn it off with that switch on the project page.",
    },
}


@dataclass(frozen=True)
class Notification:
    email: str
    ui_language: str
    title: str | None
    status: str
    user_id: UUID
    clip_count: int


@dataclass(frozen=True)
class Thumb:
    title: str | None
    url: str


@dataclass(frozen=True)
class Email:
    subject: str
    html: str
    text: str


def build_email(n: Notification, project_url: str, thumbs: list[Thumb]) -> Email:
    t = TEXT["id" if n.ui_language == "id" else "en"]
    title = n.title or t["untitled"]
    if n.status == "ready":
        subject = t["ready_subject"].format(title=title)
        if n.clip_count:
            heading = t["ready_heading"].format(n=n.clip_count, title=title)
            button = t["ready_button"].format(n=n.clip_count)
        else:
            heading = t["ready_heading_empty"].format(title=title)
            button = t["open_button"]
        body = t["ready_body"]
    else:
        subject = t["failed_subject"].format(title=title)
        heading = t["failed_heading"].format(title=title)
        body = t["failed_body"]
        button = t["open_button"]
        thumbs = []

    cells = "".join(
        f'<td width="168" valign="top" style="padding-right:16px">'
        f'<img src="{escape(th.url)}" width="168" height="298" alt="" '
        f'style="display:block;width:168px;height:298px;object-fit:cover;border-radius:12px;'
        f'background:{SURFACE_HIGHEST}">'
        f'<p style="margin:8px 0 0;font-size:12px;line-height:16px;font-weight:600;'
        f'color:{ON_SURFACE}">{escape(th.title or "")}</p></td>'
        for th in thumbs
    )
    row = f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>{cells}</tr></table>'
    html = f"""<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:{SURFACE_CONTAINER};
font-family:'Plus Jakarta Sans',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0"
 style="max-width:600px;width:100%;background:#ffffff;border-radius:16px">
<tr><td style="padding:32px">
<p style="margin:0 0 20px;font-size:20px;line-height:28px;font-weight:700;color:{PRIMARY}">
Sofish</p>
<h1 style="margin:0 0 20px;font-size:24px;line-height:32px;font-weight:700;color:{ON_SURFACE}">
{escape(heading)}</h1>
<p style="margin:0 0 20px;font-size:14px;line-height:20px;color:{ON_SURFACE_VARIANT}">
{escape(body)}</p>
{row if thumbs else ""}
<p style="margin:20px 0">
<a href="{escape(project_url)}" style="display:inline-block;padding:16px 24px;border-radius:999px;
background:{PRIMARY};color:#ffffff;font-size:16px;line-height:24px;font-weight:600;
text-decoration:none">{escape(button)}</a></p>
<hr style="border:0;border-top:1px solid {OUTLINE_VARIANT};margin:20px 0">
<p style="margin:0;font-size:12px;line-height:16px;color:{ON_SURFACE_VARIANT}">
{escape(t["footer"])}</p>
</td></tr></table>
</td></tr></table>
</body></html>"""
    text = f"{heading}\n\n{body}\n\n{button}: {project_url}\n\n{t['footer']}\n"
    return Email(subject=subject, html=html, text=text)


class Mailer:
    def __init__(self, api_key: str, sender: str, client: httpx.Client | None = None) -> None:
        self.api_key = api_key
        self.sender = sender
        self.client = client or httpx.Client(timeout=20)

    @classmethod
    def from_env(cls) -> "Mailer | None":
        key = os.environ.get("RESEND_API_KEY")
        sender = os.environ.get("NOTIFY_FROM", "Sofish <notif@sofish.tech>")
        return cls(key, sender) if key else None

    def send(self, to: str, email: Email) -> None:
        resp = self.client.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "from": self.sender,
                "to": [to],
                "subject": email.subject,
                "html": email.html,
                "text": email.text,
            },
        )
        if resp.status_code >= 300:
            raise RuntimeError(f"resend failed ({resp.status_code}): {resp.text[:300]}")


def notify_owner(
    queue: "JobQueue",
    project_id: UUID,
    mailer: Mailer | None,
    storage: "ClipStorage | None" = None,
    app_url: str | None = None,
) -> bool:
    """Send the done email once, if the project is finished. Returns True when sent."""
    n = queue.take_notification(project_id)
    if n is None or mailer is None:
        return False
    base = (app_url or os.environ.get("APP_URL") or "https://www.sofish.tech").rstrip("/")
    thumbs: list[Thumb] = []
    if storage is not None and n.status == "ready":
        for title, path in queue.top_clips(project_id, THUMBS):
            if not path or path.startswith("/"):
                continue
            try:
                thumbs.append(Thumb(title, storage.signed_url(path, THUMB_URL_SECONDS)))
            except Exception:  # noqa: BLE001 - the email still works without pictures
                log.warning("project %s: could not sign thumbnail %s", project_id, path)
    mailer.send(n.email, build_email(n, f"{base}/projects/{project_id}", thumbs))
    log.info("project %s: done email sent", project_id)
    return True
