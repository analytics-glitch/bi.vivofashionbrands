"""
Retired style list (Feb 2026).  Supplied by merch team — styles that
have been discontinued and should be hidden from "Active"-mode views
across Inventory / Products / SOR / Exports.

Matching is case-insensitive on a normalised `style_name` (lowercase,
collapsed whitespace).  Sibling colours/variants share the same
style_name in our data, so a name-based match catches all SKUs of a
retired style automatically.

Iter 89w-b — each entry now carries a `retired_at` ISO date so the
exports CSV can carry the merch-team-recorded retirement date.  Styles
on the original Feb 2026 list default to today (2026-02-13, the day
the user supplied the list).  Future additions should add their own
date below.
"""

from __future__ import annotations
import re
from typing import Iterable, Optional, Set, Dict


# Default retirement date used for the bulk list the merch team
# supplied on the same day this filter shipped.  Keeping it as a
# module-level constant (not datetime.today()) so historical CSV
# exports stay deterministic across server restarts.
DEFAULT_RETIRED_AT = "2026-02-13"


def _normalize(s: str) -> str:
    """Lowercase, strip, and collapse whitespace so list-vs-row comparisons
    don't get tripped up by stray double-spaces or trailing tabs."""
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


_RAW = """
Safari Anga Puffy Short Sleeve Tie Top
Safari Anga Wide Shorts
Safari Basic Shirt Tent Dress
Safari Bush 3/4 Sleeve Top
Safari Bush Asymmetrical Sweater Poncho
Safari Bush Drawstring Shorts
Safari Bush Men's Long Sleeve T-shirt
Safari Chui 3/4 Sleeve A-Line Dress
Safari Chui Cropped Jacket
Safari Chui Heavy Shirt
Safari Chui Jodhpur Pants
Safari Chui Lined Jacket
Safari Chui Placket Top
Safari Hawi Cargo Pants
Safari Haya Drop Shoulder Side Tie Top
Safari Haya Strappy Tie Back Maxi Dress
Safari Huru Halter Sleeveless High Low Dress
Safari Kamari Capri Cargo Pants
Safari Kamari Drop Shoulder Top
Safari Kamari Front Slit Midi Skirt
Safari Kamari Halter Shirt
Safari Kamari Long Sleeve Drawstring Shacket
Safari Kamari Mini Skirt
Safari Kamari Ribbed Top
Safari Kaya Sleeveless Tent Shirt Dress
Safari Kikoy 3/4 Sleeve Shirt
Safari Kikoy Joggers
Safari Kikoy Off Shoulder Crop Top
Safari Kikoy Tunic High Low Top
Safari Kikoy Wide Elastic Shorts
Safari Lira Front Panelled Shirt Dress
Safari Lira Sleeveless Coat
Safari Mali 3/4 Bishop Sleeve Tie Top
Safari Mali Bishop Sleeve Shirt Dress
Safari Mali Gathered Flounce Sleeve Shirt Dress
Safari Mali Off
Safari Mali Off Shoulder Ruffle Top
Safari Mali Turn Up Hem Pants
Safari Mansi Dolman Top
Safari Mansi Mens Shorts
Safari Mansi Straight Leg Pants
Safari Men's Chinese Collar Long Sleeve Shirt
Safari Naledi 3/4 Sleeve Tent Dress
Safari Nimali 3/4 Sleeve Maxi Dress
Safari Nimali Bubble Sleeve Top
Safari Nimali Ruffle Sleeve Top
Safari Njano Front Drawstring Tunic Top
Safari Njano Tie Front Wide Top
Safari Njano Wide Leg Pants
Safari Savannah Kitenge Chinese Collar Shirt
Safari Savannah Men's Jacket
Safari Savannah Men's Long Sleeve Shirt
Safari Savannah Men's Straight Leg Pants
Safari Sizani 2 Way Wrap Top
Safari Sizani Barrel Pants
Safari Sizani Men's Kitenge Placket Shirt
Safari Sizani Men's Kitenge Tuxedo Shirt
Safari Spaghetti Tank Top
Safari Tawi Flounce Tent Dress
Safari Tawi Off Shoulder Knee Length Dress
Safari Tawi Off-Shoulder Dress
Safari Tawi Off-Shoulder Top
Safari Tie Knee Length Dress
Safari Tiwa Barell Pants
Safari Tiwa Shirred Midi Dress
Safari Tiwa Shirred Top
Safari Zene Drop Shoulder Top
Safari Zene Off Shoulder Dress
Safari Zene Off Shoulder Top
Vivo 2-Way Wrap Top
Vivo Ajani Long Sleeve Top
Vivo Alani Boat Neck Maxi Dress
Vivo Alani Boat Neck Midi Dress
Vivo Alani High Low Dress
Vivo Alani Plaid Midi Dress
Vivo Aleri Coat
Vivo Alika High Waist Pants
Vivo Alora Long Sleeve Top
Vivo Alora Shift Dress
Vivo Amai Knee Length Dresses
Vivo Amai Off-Shoulder Maxi Dress
Vivo Amai Side Slit Pants
Vivo Amara Back Pleat Dress
Vivo Amara Sleeveless High Low Top
Vivo Analo Sleeveless Tie Kimono
Vivo Analo Wide Leg Pants
Vivo Ari One Shoulder Maxi Dress
Vivo Ari Sleeveless Straight Maxi Slit Dress
Vivo Asika Kaftan Tunic
Vivo Ava 3/4 Sleeve Kimono
Vivo Ava Jumpsuit
Vivo Ava Pleated Wide Leg Pants
Vivo Ava Shirt Collar Tunic Top
Vivo Ayah 3/4 Sleeve Jumpsuit
Vivo Ayah Bishop Sleeve Mock Neck Top
Vivo Ayah Drawstring Pants
Vivo Ayah Kimono
Vivo Ayah Satin Pants
Vivo Ayah Shirred Cuff Loose Top
Vivo Ayah Shirred Neck Tent Maxi Dress
Vivo Ayana Cap Sleeve High Low Tent Dress
Vivo Ayla Off-Shoulder Dress
Vivo Ayo Tent Dress
Vivo Azawi Pencil Skirt
Vivo Basic 3/4 Sleeve A-Line Wrap Maxi Dress
Vivo Basic Ali Jacket
Vivo Basic Boundneck Puff Sleeve Top
Vivo Basic Cap Sleeved Leila Dress
Vivo Basic Cowl Jersey Top
Vivo Basic Cuffed Dolman Jersey Dress
Vivo Basic Dada Poncho
Vivo Basic Destiny Chiffon Top
Vivo Basic Double Layered Wrap Poncho (Without Fringe)
Vivo Basic Drop Shoulder Dolman Dress
Vivo Basic Drop Shoulder Top
Vivo Basic Hooded Kimono
Vivo Basic Imelda Top
Vivo Basic Jeggings
Vivo Basic Jersey Cascade Waterfall
Vivo Basic Liv Chiffon Top
Vivo Basic Long Lily Waterfall
Vivo Basic Long Sleeved Double Layered Bodycon
Vivo Basic Long Sleeved Top
Vivo Basic Maternity Leggings
Vivo Basic Midi Pencil Skirt
Vivo Basic Nalia High-low Chiffon Top
Vivo Basic Neo Waterfall
Vivo Basic Palazzo Pants
Vivo Basic RT Sleeveless Bodysuit
Vivo Basic Salma Maxi Boat Neck Dress
Vivo Basic Short Lily Waterfall
Vivo Basic Short May Jersey Waterfall
Vivo Basic Sienna Jersey Top
Vivo Basic Sleeveless Double Layered Bodycon
Vivo Basic Sleeveless Extra Long Lily Waterfall
Vivo Basic Sleeveless Leila Bodycon Dress
Vivo Basic Sleeveless Long Lily Waterfall
Vivo Basic Sleeveless Midi Jersey Waterfall
Vivo Basic Sleeveless Sienna Waterfall
Vivo Basic Sleeveless Tent Kimono
Vivo Basic Spaghetti Strap Tank Top
Vivo Basic Straight Maxi Dress
Vivo Basic Straight Skirt
Vivo Basic Strappy Cowl Top
Vivo Basic V-neck Cap Sleeve Top
Vivo Basic Val Cap Sleeve Top
Vivo Beali Baby Doll Dress
Vivo Beali Sarong Skirt
Vivo Beali Shirred Midriff Top
Vivo Beali Shorts
Vivo Beali Two Way Wrap Top
Vivo Beali Wrap Shirt Dress
Vivo Chari V-Neck Top
Vivo Chela Basic Cap Sleeve Top
Vivo Chesi V-neck Jumpsuit
Vivo Chesi Wide Leg Pants
Vivo Chiffon Shorts
Vivo Chiffon Wide Kimono
Vivo Cowl Camisole
Vivo Dali 3/4 Cut Out Sleeve Maxi Dress
Vivo Dalia Off Shoulder Jumpsuit
Vivo Diella 3/4 Sleeve A-Line Dress
Vivo Diella V-Neck Jumpsuit
Vivo Diella Wide Leg Pants
Vivo Dua Dolman Top
Vivo Dua Long Bishop Sleeve Top
Vivo Essentials Biker Shorts
Vivo Essentials Sleeveless One Shoulder Crop Top
Vivo Extra Long May Jersey Waterfall
Vivo Fahari 3/4 Sleeve Shirred Shirt
Vivo Faraji Side Slit Leisure Pants
Vivo Fasi Strapless Top
Vivo Fitness Capri Leggings
Vivo Full Length Kimono
Vivo Golf Fly Front Shorts
Vivo Golf Long Sleeved Zip Up Jacket
Vivo Hadiya Flounce Sleeve Maxi
Vivo Halter Maxi With Lining
Vivo Hamle Drapped Front Bodycon
Vivo Hamle Front Twist Bodysuit
Vivo Hamle Side Twist Tie Top
Vivo Hanabi Tent Maxi Dress
Vivo Hari Flared Sleeve Tunic
Vivo Hooded Kimono With Elastic Cuff
Vivo Imara Puff Sleeve Sheath Dress
Vivo Isabi Cowl Top
Vivo Iyana Bow Tie Mini Dress
Vivo Iyana Bubble Midi Skirt
Vivo Iyana Tank Top
Vivo Iyana Wide Leg Pants
Vivo J.O V-Neck Sheath Dress
Vivo Jamila Halter Neck Knee Length Dress
Vivo Jasiri Bishop Sleeve Shift Dress
Vivo Jema High Low Tent Dress
Vivo Jema High Slit Maxi Kimono
Vivo Jira Capri Leggings
Vivo Jira Front Overlap Midriff Top
Vivo Jira Lounge Pants
Vivo Jira Sleeveless Waterfall
Vivo Joggers
Vivo Kala Gathered Front Top
Vivo Kala Long Sleeve Top
Vivo Kala Palazzo Pants
Vivo Kala Slit Maxi Dress
Vivo Kelemi 4.0 Frilled Wide Top
Vivo Kelemi 4.0 Kimono
Vivo Kelemi 4.0 Sleeveless Dress
Vivo Kelemi 4.0 Sleeveless Top
Vivo Kelemi Flared Sleeve Kimono
Vivo Kelemi Hooded Kimono
Vivo Kelemi Ruffle Sleeve Top
Vivo Kitenge Bubble Sleeve Tent Dress
Vivo Kitenge Infinity Jumpsuit
Vivo Kitenge Midi Kimono
Vivo Kitenge Wrap Skirt
Vivo Laika Long Sleeve Mandarin Top
Vivo Laika Long Sleeve Tie Top
Vivo Lamu Knee Length Chiffon Dress
Vivo Lamu Knee Length Cold Shoulder Dress
Vivo Leila 3/4 Sleeve Tent Knee Length Dress
Vivo Leila Cap Sleeve Tent Knee Length Dress
Vivo Leila Hip Length Waterfall
Vivo Leila Short Sleeve Bodycon
Vivo Lero Capri Leggings
Vivo Lero Fitness Leggings
Vivo Liv Wide Crepe Top
Vivo Long Sleeve Blazer
Vivo Lumi Cuffed Dolman Maxi Dress
Vivo Maisha Long Sleeve High Low Kimono
Vivo Mandla High Neck A-Line Dress
Vivo Mandla Side Flap A-Line Dress
Vivo Meli Puff Sleeve Shift Dress
Vivo Meli Ruffle Sleeve Top
Vivo Meli Satin Pants
Vivo Meli Sleeveless Coat
Vivo Merika Knee Length Wrap Dress
Vivo Merika Midi Wrap Dress
Vivo Mira Reversible Wrap Top
Vivo Mira Straight Leg Pants
Vivo Mira V-Neck Overlap Top
Vivo Mock Maxi Dress
Vivo Must Have Shorts
Vivo Nala Shift Dress
Vivo Nala Shirt Dress
Vivo Nasinka Ruffle Sleeve Jumpsuit
Vivo Nasinka V-Neck Maxi Dress
Vivo Naya Cigarette Pants
Vivo Naya Flounce High Low Top
Vivo Naya One Shoulder Flounce Jumpsuit
Vivo Naya One Shoulder Flounce Satin Crop Top
Vivo Naya One Shoulder Flounce Top
Vivo Naya Wide Leg Pants
Vivo Niari Boat Neck Dress
Vivo Niari Full Length Pants
Vivo Niari Shorts
Vivo Niari straight leg Pants
Vivo Nimali Satin Blouse
Vivo Nimali Satin Halter Top
Vivo Nimali Satin Joggers
Vivo Nimali Satin Short Kimono
Vivo Nimali Satin Shorts
Vivo Nimali Satin Wide-Leg Pants
Vivo Nkasi Asymmetrical Top
Vivo Nkasi Wide Leg Pants
Vivo Nkasi Wide Top
Vivo Nora 3/4 Sleeve Peplum Top
Vivo Nora Front Pleat Knee Length Dress
Vivo Nora Front Slit Knee Length Skirt
Vivo Paji 3/4 Sleeve Shift Dress (Tall)
Vivo Paji Boat Neck Sheath Dress
Vivo Paji Dress Coat
Vivo Pana Cascade Waterfall
Vivo Pelia Kimono
Vivo Pesi Basic Long Sleeve Shirt
Vivo Pesi Drop Shoulder Tent Dress
Vivo Pesi Drop Shoulder Tunic
Vivo Ponte Back Pleat High Low Dress
Vivo Ponte Back Pleat Maxi Dress
Vivo Reba Dolman Dress
Vivo Reba Gathered Dress
Vivo Reba Tent Shirt Dress
Vivo Rema Drawstring Pants
Vivo Rema High Low Maxi Dress
Vivo Rema Waterfall
Vivo Ria Drop Shoulder Top
Vivo Ria Mock Neck Top
Vivo Safa Drawstring Wide Top
Vivo Safa Pallazo Pants
Vivo Safa Skirt
Vivo Safa Slit Side Top
Vivo Safiya Back Pleat Dress
Vivo Safiya Gathered Shoulder Maxi Dress
Vivo Saida Cigarrets Pants
Vivo Saida Straight Leg Pants
Vivo Sana Asymmetrical Angel Sleeve Top
Vivo Sana Long Sleeved Maxi cover-Up
Vivo Sanali Off
Vivo Sanali Tent Knee Length Dress
Vivo Sanali Trench Coat
Vivo Sanyu Boat Neck Midriff Top
Vivo Sanyu Bubble Sleeve Tent Dress
Vivo Sanyu Maxi Tent Dress
Vivo Sanyu Pleated Pants
Vivo Sarabi Panelled V-Neck Kaftan
Vivo Sarong Skirt
Vivo Satin Drawstring Pants
Vivo Sawari Long Sleeve V-Neck Midriff Top
Vivo Selah Midi Skirt
Vivo Seli Maxi Skirt
Vivo Seli Shorts
Vivo Seli Strappy Tent Top
Vivo Serwa Crepe Pants
Vivo Serwa Square Neck Maxi Dress
Vivo Serwa Tiered Maxi Skirt
Vivo Serwa Wide Leg Jumpsuit
Vivo Short Side Pleat Sweater
Vivo Shorts
Vivo Sia Leisure Pants
Vivo Sierra Bishop Sleeve Top
Vivo Situ Side Slit Midi Kimono
Vivo Sleeveless Blazer
Vivo Sleeveless Side Slit Midi Waterfall
Vivo Sleeveless Sweater Bodycon
Vivo Solei Shorts(without lining)
Vivo Soleil Handkerchief Drape Wide Top
Vivo Soleil Shorts
Vivo Soleil Sleeveless Drape Jumpsuit
Vivo Tahisa Straight Leg Pants
Vivo Tana Off Shoulder Maxi Dress
Vivo Tana Puff Sleeve A-Line Dress
Vivo Tanda A-Line Maxi Dress
Vivo Tande Boat Neck Dress
Vivo Tande Camisole
Vivo Tatari Cap Sleeve Sheath Dress
Vivo Tatari Dropped High Neck Top
Vivo Tatari Knee Length Coat
Vivo Tatari Panelled Skirt
Vivo Tolani Dress
Vivo Trench Coat
Vivo Tsavo Scalloped Hem Dress Top
Vivo Tsavo Sleeveless Scalloped Hem Dress Top
Vivo Vinna 3/4 Seeve A-Line Dress
Vivo Vinna Escape A-Line Dress
Vivo Vinna Knee Length Piped Skirt
Vivo Vinna Slit Sleeve Top
Vivo Wena High Slit Maxi Shirt
Vivo Wena Wrap Dress
Vivo Wide Leg Chiffon Pants
Vivo Wila Dolman Tunic
Vivo Wila Turn Up Coat
Vivo Wingu Puff Sleeve Knee Length Dress
Vivo Wingu Three Tiered Knee Length Dress
Vivo X Pinky Sleeveless Crossback Fitness Midriff Top
Vivo Yene High Slit Tunic Top
Vivo Yene Jumpsuit
Vivo Yene Layered Midi Dress
Vivo Yene Layered Top
Vivo Yene One Shoulder Maxi Dress
Vivo Yene One Soulder Kaftan
Vivo Yene V Neck Slip Dress
Vivo Yene Wide Leg Pants
Vivo Yoga Wrap
Vivo Zahari Bishop Sleeve Top With Belt
Vivo Zahari Drawstring Wide Leg Pants
Vivo Zahari Straight Leg Pants
Vivo Zahari Sweatheart Neck Jumpsuit
Vivo Zaria Long Sleeve Coat
Vivo Zawadi Inverted Pleat Dress
Vivo Zena Bishop Panel Long Sleeve Round Neck Dress
Vivo Zena Sleeveless Shawl Collar Overcoat
Zoya Aridi Cropped Jacket
Zoya Aridi Unisex Shacket (Corduroy)
Zoya Banda Bandeau Asymmetrical Crop Top
Zoya Banda Drop Shoulder Unisex Wide Jacket
Zoya Banda Halter Neck Assymetrical Crop Top
Zoya Banda High Slit Maxi Skirt
Zoya Banda Lantern Pants
Zoya Banda Men's Cargo Pants
Zoya Banda Strappy Playsuit
Zoya Banda Unisex Jorts
Zoya Banda Unisex Letterman Jacket
Zoya Banda Unisex Shacket
Zoya Banda Waist Length Zipped Jacket
Zoya Basic Halter Tie Top
Zoya Basic Long Sleeve Bodycon
Zoya Basic Long Sleeve Top
Zoya Basic Racer Back Crop Top
Zoya Basic Short Sleeve Crop Top
Zoya Basic Sleeveless Bodysuit
Zoya Basic Tank Top
Zoya Essentials Mini Bodycon
Zoya Fitness Bra Style # 2
Zoya Kyro Pleated Mini Skirt
Zoya Kyro Sleeveless Bodysuit
Zoya Kyro Straight Leg Pants
Zoya Kyro Strappy Vest
Zoya Luna Cargo Pants
Zoya Luna Drape Tie Top
Zoya Luna Drawstring Maxi Dress
Zoya Luna Halter Neck Top
Zoya Luna High Slit Dress
Zoya Nia Cargo Overalls
Zoya Nia Cargo Shorts
Zoya Nia Long Sleeved Crop Shacket
Zoya Nia Off Shoulder Knee Length Dress
Zoya Nia Off Shoulder Puff Sleeve Top
Zoya Nia Oversized Denim Shirt
Zoya Nia Puff Sleeve Off Shoulder Romper
Zoya Nia Wide Cargo Pants
Zoya Nia Wide Leg Denim Pants
Zoya Nia Wide Leg Shorts
Zoya Party Cowl Bare Back Mini Dress
Zoya Party Low V-Neck Bodysuit
Zoya Party Sheer Pants
Zoya Party Sleeveless Bodysuit
Zoya Party Sleeveless Side Cut Midi Dress
Zoya Sadira Bell Bottom Pants
Zoya Sadira Bell Bottom Unitard
Zoya Sadira Cargo Shorts
Zoya Sadira Midriff Polo T-Shirt
Zoya Sadira Mini Bubble Dress
Zoya Sadira Mini Cargo Skirt
Zoya Sadira Ribbed Top
Zoya Sadira Strappy Bodysuit
Zoya Shani Cropped Tie Top
Zoya Shani Off Shoulder Crop Top
Zoya Shani Pleated Pants
Zoya Shani Sarong Wrap
Zoya Shani Satin Off Shoulder Crop Top
Zoya Shani Scarf Top
Zoya Sitawi A-line Mini Dress
Zoya Sitawi Bodycon
Zoya Sitawi Cropped Jacket
Zoya Sitawi Square Neck Bodysuit
Zoya Taani Easy Fit Joggers
Zoya Taani Maxi Dress
Zoya Taani Midriff Hoodie
Zoya Taani Mini Dress
Zoya Taani Side Slit Hoodie
Zoya Taani Sleeveless Midriff Top
Zoya Taani Wide Joggers
Zoya Temo Asymmetric Front Cut Crop Top
Zoya Temo Bubble Mini Skirt
Zoya Temo Mens Short Sleeve T-shirt
Zoya Temo Parachute Pants
Zoya Temo Straight Leg Pants
Zoya Vasha Biker Shorts
Zoya Vasha Hooded Jacket
Zoya Vasha Raglan Sleeve Playsuit
Zoya Vasha Short Sleeve Mesh Top
Zoya Vasha Sleeveless Turtleneck Mini Bodycon
Zoya Vasha Sleeveless Turtleneck Top
Zoya X Metamorphisized 143 Cropped Bomber Jacket
Zoya X Metamorphisized 143 Cropped Jacket
Zoya X Metamorphisized 143 Oversized Bowling Shirt
Zoya X Metamorphisized 143 Oversized Long Sleeve Shirt
Zoya X Metamorphisized 143 Pleated Flannel Mini Skirt
Zoya X Metamorphisized 143 Raglan Sleeve Crop Top
Zoya X Metamorphisized 143 Raglan Sleeve Midriff Top
Zoya Yuni Contrast Stitch Mini Skirt
Zoya Yuni Halter Dress
Zoya Yuni Halter Midriff Top
Zoya Yuni Halter Neck Tie Back Top
Zoya Yuni High Slit Dress
Zoya Yuni Off Shoulder Bodysuit
Zoya Yuni Off Shoulder Midriff Top
Zoya Yuni Off shoulder Mini Dress
Zoya Yuni Oversized Shirt
Zoya Yuni Short Sleeve Midriff Top
Zoya Yuni Sleeveless Turtle Neck Maxi Top
Zoya Yuni Strappy Midriff Top
Zoya Yuni Tank Top
Zoya Yuni Wide Leg Pants
"""

# Frozen set of normalised retired style names. Built at import time so
# the membership check is O(1) per row across millions of rows.
RETIRED_STYLE_NAMES: Set[str] = frozenset(
    _normalize(line) for line in _RAW.splitlines() if line.strip()
)

# Map of normalised name → retirement ISO date.  Future additions (e.g.
# a style retired on a different day) should be appended here using
# `_normalize("Some Style Name"): "YYYY-MM-DD"`.
RETIRED_STYLE_DATES: Dict[str, str] = {
    name: DEFAULT_RETIRED_AT for name in RETIRED_STYLE_NAMES
}


def is_retired(style_name: Optional[str]) -> bool:
    """Returns True if the given style name matches any retired entry
    (case-insensitive, whitespace-normalised)."""
    if not style_name:
        return False
    return _normalize(style_name) in RETIRED_STYLE_NAMES


def retired_at(style_name: Optional[str]) -> Optional[str]:
    """Returns the recorded retirement ISO date for `style_name`, or
    None if the style is not on the retired list."""
    if not style_name:
        return None
    return RETIRED_STYLE_DATES.get(_normalize(style_name))


def filter_rows(
    rows: Iterable[dict],
    status: Optional[str],
    field: str = "style_name",
) -> list:
    """Apply the Active/Retired/All filter to an iterable of rows.

    status:
      • None / "" / "all"  → return rows unchanged
      • "active"           → drop retired rows
      • "retired"          → keep only retired rows
    field: which dict key holds the style name (default "style_name";
    some endpoints use "product_name" — pass it explicitly).
    """
    s = (status or "all").strip().lower()
    if s in ("", "all"):
        return list(rows)
    if s == "active":
        return [r for r in rows if not is_retired(r.get(field))]
    if s == "retired":
        return [r for r in rows if is_retired(r.get(field))]
    return list(rows)


def annotate_status(rows: Iterable[dict], field: str = "style_name") -> list:
    """Add `style_status` ("active"|"retired") and `retired_at` (ISO
    date string or None) to each row.  Useful for endpoints that want
    to expose the status to the frontend (e.g. for rendering a badge
    or surfacing the retirement date in a CSV) even when no filter is
    applied."""
    out: list = []
    for r in rows:
        rr = dict(r)
        name = rr.get(field)
        if is_retired(name):
            rr["style_status"] = "retired"
            rr["retired_at"] = RETIRED_STYLE_DATES.get(_normalize(name))
        else:
            rr["style_status"] = "active"
            rr["retired_at"] = None
        out.append(rr)
    return out
