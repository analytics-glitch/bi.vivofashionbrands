"""Iter 79 — Gmail SMTP alert sender for the standing 2-hour audit.

All sends are best-effort and never raise. The audit job continues even
if email delivery fails — a delivery failure is logged into the audit
record so the admin UI can flag it.

Env vars (all required for sending; missing → graceful skip):
    SMTP_HOST          smtp.gmail.com
    SMTP_PORT          587
    SMTP_USER          sender mailbox (e.g. admin@vivofashiongroup.com)
    SMTP_PASSWORD      Gmail App Password (NOT account password)
    SMTP_FROM_NAME     display name on the From: header
    ALERT_RECIPIENTS   comma-separated email addresses
"""
from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from typing import List, Optional

logger = logging.getLogger("server.email_alert")


def _recipients() -> List[str]:
    raw = os.environ.get("ALERT_RECIPIENTS", "")
    return [a.strip() for a in raw.split(",") if a.strip()]


def email_configured() -> bool:
    """Public probe used by the admin UI to know whether to render the
    "email alerts enabled" pill."""
    return all([
        os.environ.get("SMTP_HOST"),
        os.environ.get("SMTP_PORT"),
        os.environ.get("SMTP_USER"),
        os.environ.get("SMTP_PASSWORD"),
        _recipients(),
    ])


def send_alert(subject: str, body: str, recipients: Optional[List[str]] = None) -> dict:
    """Send a plain-text alert. Returns a dict {ok, error?, sent_to[]}.

    Never raises — the audit must run to completion even when email is
    misconfigured or the Gmail SMTP relay is unreachable.
    """
    host = os.environ.get("SMTP_HOST")
    port_raw = os.environ.get("SMTP_PORT")
    user = os.environ.get("SMTP_USER")
    pw = os.environ.get("SMTP_PASSWORD")
    from_name = os.environ.get("SMTP_FROM_NAME", "Vivo BI Monitor")
    to = recipients if recipients else _recipients()

    if not all([host, port_raw, user, pw, to]):
        logger.warning("[email] alert SKIPPED — SMTP env not configured (subject=%r)", subject)
        return {"ok": False, "error": "smtp_not_configured", "sent_to": []}

    try:
        port = int(port_raw)
    except Exception:
        return {"ok": False, "error": "smtp_port_invalid", "sent_to": []}

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{user}>"
    msg["To"] = ", ".join(to)
    msg.set_content(body)

    try:
        context = ssl.create_default_context()
        with smtplib.SMTP(host, port, timeout=20) as s:
            s.ehlo()
            s.starttls(context=context)
            s.ehlo()
            s.login(user, pw)
            s.send_message(msg)
        logger.info("[email] sent — subject=%r to=%s", subject, ",".join(to))
        return {"ok": True, "sent_to": to}
    except smtplib.SMTPAuthenticationError as e:
        # Most common failure — wrong app password or 2FA not enabled.
        logger.error("[email] AUTH failed — %s. Check SMTP_PASSWORD is a Google App Password.", e)
        return {"ok": False, "error": f"auth_failed: {e!s}", "sent_to": []}
    except Exception as e:
        logger.error("[email] send failed (subject=%r): %s", subject, e)
        return {"ok": False, "error": str(e), "sent_to": []}
