"""
Iter 91q — Weekly Marketing Action Report.

Builds an HTML email digest of:
  • This week's marketing action candidates (≥4w post-launch, SOR<40%)
  • Actions currently in flight (started < 14 days ago)
  • Action history with SOR-delta (which actions are working)

Auto-sent every Monday morning at 08:00 Africa/Nairobi to the
MARKETING_REPORT_TO inbox, with MARKETING_REPORT_CC on CC.
"""
from __future__ import annotations
import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _fmt_pct(v) -> str:
    if v is None:
        return "—"
    try:
        return f"{float(v):.1f}%"
    except Exception:
        return "—"


def _fmt_num(v) -> str:
    if v is None:
        return "—"
    try:
        return f"{int(v):,}"
    except Exception:
        return str(v)


def _fmt_delta(v) -> str:
    if v is None:
        return "—"
    try:
        v = float(v)
    except Exception:
        return "—"
    sign = "+" if v >= 0 else ""
    colour = "#047857" if v >= 0 else "#be123c"
    return f'<span style="color:{colour};font-weight:600">{sign}{v:.1f} pp</span>'


def build_report_html(
    *,
    candidates: List[Dict[str, Any]],
    in_flight: List[Dict[str, Any]],
    history: List[Dict[str, Any]],
    threshold_pct: float,
    age_min_weeks: float,
) -> str:
    today = datetime.now(timezone.utc).date().isoformat()
    css_table = (
        'style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;'
        'font-size:12px"'
    )
    css_th = (
        'style="background:#f4f4f5;color:#52525b;text-align:left;padding:6px 8px;'
        'border-bottom:1px solid #d4d4d8"'
    )
    css_td = 'style="padding:6px 8px;border-bottom:1px solid #f4f4f5"'

    # Candidates table.
    def _row_candidate(c: Dict[str, Any]) -> str:
        return (
            f'<tr><td {css_td}>{c.get("style_name") or "—"}<br>'
            f'<span style="color:#71717a;font-size:11px">{c.get("style_number") or ""}</span></td>'
            f'<td {css_td}>{c.get("subcategory") or "—"}</td>'
            f'<td {css_td}>{c.get("launch_date") or "—"}</td>'
            f'<td {css_td} align="right">{c.get("age_weeks", 0):.1f}w</td>'
            f'<td {css_td} align="right"><b style="color:#be123c">{_fmt_pct(c.get("sor_lifetime"))}</b></td>'
            f'<td {css_td} align="right">{_fmt_num(c.get("units_online"))}</td>'
            f'<td {css_td} align="right">{_fmt_num(c.get("units_stores"))}</td>'
            f'<td {css_td} align="right">{_fmt_num(c.get("soh_warehouse"))}</td>'
            f'<td {css_td} align="right">{_fmt_num(c.get("soh_stores"))}</td>'
            f'<td {css_td} align="right"><b>{_fmt_num(c.get("current_stock"))}</b></td></tr>'
        )

    def _row_action(a: Dict[str, Any]) -> str:
        disc = f' ({a.get("discount_pct")}%)' if a.get("discount_pct") else ""
        return (
            f'<tr><td {css_td}>{a.get("style_name") or "—"}<br>'
            f'<span style="color:#71717a;font-size:11px">{a.get("style_number")}</span></td>'
            f'<td {css_td}><span style="background:#fed7aa;color:#9a3412;padding:2px 6px;'
            f'border-radius:4px;font-weight:600">{a.get("action_type")}{disc}</span></td>'
            f'<td {css_td}>{a.get("started_at") or "—"}</td>'
            f'<td {css_td} align="right">{_fmt_pct(a.get("sor_lifetime_at_start"))}</td>'
            f'<td {css_td} align="right"><b>{_fmt_pct(a.get("sor_lifetime_now"))}</b></td>'
            f'<td {css_td} align="right">{_fmt_delta(a.get("sor_delta"))}</td>'
            f'<td {css_td}>{a.get("created_by") or "—"}</td></tr>'
        )

    cand_table = (
        f'<table {css_table}>'
        f'<thead><tr>'
        f'<th {css_th}>Style</th><th {css_th}>Subcat</th><th {css_th}>Launch</th>'
        f'<th {css_th}>Age</th><th {css_th}>SOR</th>'
        f'<th {css_th}>U-Online</th><th {css_th}>U-Stores</th>'
        f'<th {css_th}>Stock WH</th><th {css_th}>Stock Stores</th><th {css_th}>Stock Total</th>'
        f'</tr></thead><tbody>'
        + "".join(_row_candidate(c) for c in candidates[:50])
        + '</tbody></table>'
    )
    if not candidates:
        cand_table = '<p style="color:#71717a;font-size:12px">No new candidates this week — good news.</p>'

    in_flight_table = (
        f'<table {css_table}>'
        f'<thead><tr>'
        f'<th {css_th}>Style</th><th {css_th}>Subcat</th><th {css_th}>Launch</th>'
        f'<th {css_th}>Age</th><th {css_th}>SOR</th>'
        f'<th {css_th}>U-Online</th><th {css_th}>U-Stores</th>'
        f'<th {css_th}>Stock WH</th><th {css_th}>Stock Stores</th><th {css_th}>Stock Total</th>'
        f'</tr></thead><tbody>'
        + "".join(_row_candidate(c) for c in in_flight[:50])
        + '</tbody></table>'
    ) if in_flight else '<p style="color:#71717a;font-size:12px">No actions in flight this week.</p>'

    history_recent = history[:20]
    history_table = (
        f'<table {css_table}>'
        f'<thead><tr>'
        f'<th {css_th}>Style</th><th {css_th}>Action</th><th {css_th}>Started</th>'
        f'<th {css_th}>SOR @ Start</th><th {css_th}>SOR Now</th><th {css_th}>Δ SOR</th>'
        f'<th {css_th}>By</th></tr></thead><tbody>'
        + "".join(_row_action(a) for a in history_recent)
        + '</tbody></table>'
    ) if history_recent else '<p style="color:#71717a;font-size:12px">No actions logged yet.</p>'

    summary_box = (
        f'<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">'
        f'<tr><td style="padding:8px 16px 8px 0">'
        f'<span style="color:#71717a">Candidates needing action</span><br>'
        f'<b style="font-size:24px;color:#be123c">{len(candidates)}</b></td>'
        f'<td style="padding:8px 16px 8px 0">'
        f'<span style="color:#71717a">Actions in flight</span><br>'
        f'<b style="font-size:24px;color:#b45309">{len(in_flight)}</b></td>'
        f'<td style="padding:8px 16px 8px 0">'
        f'<span style="color:#71717a">Actions logged (total)</span><br>'
        f'<b style="font-size:24px;color:#1f2937">{len(history)}</b></td></tr>'
        f'</table>'
    )

    return f"""
<!doctype html>
<html><body style="margin:0;padding:24px;background:#fafafa;font-family:Arial,sans-serif">
  <table cellpadding="0" cellspacing="0" style="width:100%;max-width:880px;margin:0 auto;background:white;border-radius:8px;padding:24px;border:1px solid #e4e4e7">
    <tr><td>
      <h1 style="margin:0 0 4px 0;font-size:22px;color:#18181b">Vivo BI · Weekly Marketing Action Report</h1>
      <p style="margin:0 0 16px 0;color:#71717a;font-size:13px">
        Report date: <b>{today}</b> · Rule: SOR &lt; {threshold_pct}% AND age ≥ {age_min_weeks} weeks
      </p>
      {summary_box}
      <h2 style="margin:24px 0 8px 0;font-size:16px;color:#18181b">Candidates Needing Action</h2>
      <p style="margin:0 0 8px 0;color:#52525b;font-size:12px">Lowest-SOR styles awaiting a marketing intervention. Showing top 50.</p>
      {cand_table}
      <h2 style="margin:24px 0 8px 0;font-size:16px;color:#18181b">Actions In Flight</h2>
      <p style="margin:0 0 8px 0;color:#52525b;font-size:12px">Styles with an action logged in the last 14 days. SOR progression is tracked from start.</p>
      {in_flight_table}
      <h2 style="margin:24px 0 8px 0;font-size:16px;color:#18181b">Recent Action History</h2>
      <p style="margin:0 0 8px 0;color:#52525b;font-size:12px">Δ SOR shows how much each action moved the needle since it was logged. Green = positive impact.</p>
      {history_table}
      <p style="margin:24px 0 0 0;color:#a1a1aa;font-size:11px">
        Sent automatically by Vivo BI · analytics@vivofashiongroup.com · Generated {datetime.now(timezone.utc).isoformat(timespec="seconds")}
      </p>
    </td></tr>
  </table>
</body></html>
"""


async def send_marketing_weekly_report(
    *,
    candidates: List[Dict[str, Any]],
    in_flight: List[Dict[str, Any]],
    history: List[Dict[str, Any]],
    threshold_pct: float,
    age_min_weeks: float,
) -> Dict[str, Any]:
    """Sends the HTML report via Resend. Returns
    `{ok, message, email_id?}`. No-op (warning) if the API key isn't
    configured — lets the rest of the stack work end-to-end before the
    user wires Resend up."""
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        msg = "RESEND_API_KEY is not configured — set it in /app/backend/.env and restart."
        logger.warning("[marketing-report] %s", msg)
        return {"ok": False, "message": msg, "skipped": True}

    sender = os.environ.get("SENDER_EMAIL", "analytics@vivofashiongroup.com")
    to_csv = os.environ.get("MARKETING_REPORT_TO", "")
    cc_csv = os.environ.get("MARKETING_REPORT_CC", "")
    to_list = [e.strip() for e in to_csv.split(",") if e.strip()]
    cc_list = [e.strip() for e in cc_csv.split(",") if e.strip()]
    if not to_list:
        return {"ok": False, "message": "MARKETING_REPORT_TO is empty in .env"}

    html = build_report_html(
        candidates=candidates, in_flight=in_flight, history=history,
        threshold_pct=threshold_pct, age_min_weeks=age_min_weeks,
    )
    subject = f"Vivo BI — Weekly Marketing Action Report · {datetime.now(timezone.utc).date().isoformat()}"

    import resend  # local import keeps boot fast when integration is unused
    resend.api_key = api_key
    params = {
        "from": sender,
        "to": to_list,
        "cc": cc_list,
        "subject": subject,
        "html": html,
    }
    try:
        email = await asyncio.to_thread(resend.Emails.send, params)
        return {"ok": True, "message": f"Sent to {', '.join(to_list)}",
                "email_id": email.get("id") if isinstance(email, dict) else None}
    except Exception as e:
        logger.exception("[marketing-report] resend send failed: %s", e)
        return {"ok": False, "message": f"Resend error: {e}"}
