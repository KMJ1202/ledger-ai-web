#!/usr/bin/env python3
"""Refresh every heyledger.ai phone screen to the build-75 app layout and put the
full feature map in plain sight. Kyle override 1202, 2026-09-02 10:40.

Idempotent: every insert is keyed on a marker comment and skipped when present.
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CSS_V = "46"

# ---------- balanced-div helpers ----------
TAG = re.compile(r"<div\b|</div>")

def block_end(html, start):
    """Index just past the </div> that closes the <div at `start`."""
    depth = 0
    for m in TAG.finditer(html, start):
        depth += 1 if m.group(0) == "<div" else -1
        if depth == 0:
            return m.end()
    raise ValueError("unbalanced div")

def find_block(html, marker, occurrence=1):
    pos = -1
    for _ in range(occurrence):
        pos = html.find(marker, pos + 1)
        if pos < 0:
            raise ValueError(f"marker not found: {marker}")
    return pos, block_end(html, pos)

def replace_block(html, marker, new, occurrence=1):
    a, b = find_block(html, marker, occurrence)
    return html[:a] + new + html[b:]

def extract_block(html, marker, occurrence=1):
    a, b = find_block(html, marker, occurrence)
    return html[a:b]

# ---------- shared fragments ----------
INDEX = (ROOT / "index.html").read_text()
APPTABS_SRC = extract_block(INDEX, '<div class="apptabs"')

def apptabs(on, badge=None):
    """The 5-tab bar with tab `on` (0-4) lit; `badge` = (tab_index, count)."""
    parts = APPTABS_SRC.split("<span")
    out = [parts[0]]
    for i, p in enumerate(parts[1:]):
        p = p.replace(' class="on"', "", 1)
        if i == on:
            p = p.replace(">", ' class="on">', 1)
        if badge and badge[0] == i:
            p = p.replace("<svg", f'<b class="bd" data-n="{badge[1]}"></b><svg', 1)
        out.append(p)
    return "<span".join(out)

MARK = '<span class="lmark"><img src="/assets/logo-mark-96.png" alt=""></span>'
SYNC = '<span class="lbtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg></span>'
AVATAR = '<span class="lbtn av"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4zm0 2c-4 0-7.5 2-7.5 4.6V20h15v-1.4C19.5 16 16 14 12 14z"/></svg></span>'

def lbar(right=SYNC):
    return f'<div class="lbar" aria-hidden="true">{MARK}<span class="lname">Ledger AI</span>{right}</div>'

def ltitle(t):
    return f'<h3 class="ltitle">{t}</h3>'

I = {  # tiny stroke icons for the lane pill
 "chart": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 19h16M7 15v-4M12 15V7M17 15v-6"/></svg>',
 "trend": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
 "receipt": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
 "tray": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13l2-8h14l2 8v6H3z"/><path d="M3 13h5l1.5 2h5L16 13h5"/></svg>',
 "bars": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 19V9M12 19V5M19 19v-7"/></svg>',
 "bolt": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
 "people": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.5c2.8 0 5 1.6 5 4.2"/></svg>',
 "star": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.2 6.1L12 16.9l-5.5 2.9 1.2-6.1L3.2 9.4l6.1-.8z"/></svg>',
 "check": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3M4 12h3M4 17h3M10 7h10M10 12h10M10 17h10"/></svg>',
}

def pill(items, on):
    """items = [(icon, label, badge_html)], on = index."""
    s = '<div class="lpill" aria-hidden="true">'
    for i, (ic, lab, bd) in enumerate(items):
        cls = ' class="on"' if i == on else ""
        s += f'<span{cls}>{I[ic]}{lab}{bd}</span>'
    return s + "</div>"

FIN_PILL = lambda on, profit=2: pill([("chart", "Overview", ""), ("trend", "Profit", f'<b class="n">{profit}</b>' if profit else ""), ("receipt", "Receipts", "")], on)
PHONE_PILL = lambda on, auto="3/5": pill([("tray", "Needs You", ""), ("bars", "Today", ""), ("bolt", "Auto", f'<b class="n warn">{auto}</b>' if auto else "")], on)
CUST_PILL = lambda on, rev=1, todo=0: pill([("people", "Directory", ""), ("star", "Reviews", f'<b class="n">{rev}</b>' if rev else ""), ("check", "To-do", f'<b class="n warn">{todo}</b>' if todo else "")], on)

def screen(tint, inner):
    return f'<div class="screen tint-{tint}">{inner}</div>'

def gcard(cls, eb, big, sub, right=None, lbl=None):
    r = f'<span class="r"><i></i>{right}</span>' if right else ""
    l = f'<p class="lbl">{lbl}</p>' if lbl else ""
    return f'<div class="gcard {cls}"><div class="eb"><b>{eb}</b>{r}</div>{l}<p class="big">{big}</p><p class="sub">{sub}</p></div>'

# ---------- screens ----------
def home_hero_screen(hstage, stabs):
    ask = (
        '<div class="gcard pu"><div class="askhead"><b><i></i><span id="heroChLabel">Ask Ledger</span></b><span class="lv"><i></i><span id="heroChLive">Live</span><span id="heroChIcon" hidden></span></span></div>'
        + '<div class="chatdemo herodemo" id="heroDemo">' + hstage + stabs + '</div>'
        + '<div class="acomposer" aria-hidden="true"><span class="field">How much profit did we make today?</span><span class="send">↑</span></div>'
        + '<div class="chips" aria-hidden="true">'
        + '<span><i style="background:var(--emerald)"></i>Profit today</span><span><i style="background:var(--gold)"></i>Reply to review</span>'
        + '<span><i style="background:var(--orange)"></i>Who owes me?</span><span><i style="background:var(--blue)"></i>Missed calls</span>'
        + '<span><i style="background:var(--magenta)"></i>Tomorrow\'s day</span><span><i style="background:var(--red)"></i>File this receipt</span>'
        + '</div></div>'
    )
    body = (
        '<div class="lbody">'
        + '<div class="idcard"><span class="logo"><img src="/assets/logo-mark-96.png" alt=""></span><div><h4>Ledger AI</h4><p>Your business, answered.</p><div class="st"><i></i>Ready</div></div></div>'
        + '<div class="setrow"><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></span><div><b>Business profile &amp; settings</b><small>Connections · branding · team</small></div><span class="go">↗</span></div>'
        + ask
        + '</div>'
    )
    return ('<div class="phonewrap"><div class="phoneframe floaty">'
            + screen("home", lbar(AVATAR) + body + apptabs(0, (3, 2)))
            + '</div></div>')

def reviews_screen(appbody2):
    return ('<div class="phoneframe">'
            + screen("customers", lbar() + ltitle("Reviews") + CUST_PILL(1) + appbody2 + apptabs(4))
            + '</div>')

def phone_needsyou_screen():
    body = (
        '<div class="lbody">'
        + '<div class="custcard"><div class="who"><span class="av">MR</span><div><h4>Marcus Reid</h4><div class="meta">2019 Ford F-150 XLT · 275/65R18 · last: 4 winters, Nov 2025</div></div><span class="ago">● 6 min</span></div>'
        + '<div class="wait">💬 Waiting on you</div>'
        + '<div class="acts"><span class="pri">📞 Call</span><span>💬 Text</span><span>📅 Book</span></div>'
        + '<div class="foot"><b>(587) 555-0142</b> After hours <span class="r">Ledger answers</span></div></div>'
        + PHONE_PILL(0)
        + '<div class="lsec">Needs you</div>'
        + '<div class="gcard cy"><div class="eb"><b>Missed call · 2:41 PM</b><span class="r"><i></i>Auto-texted 0:04 later</span></div><p class="lbl">"Needs 4 tires for an F-150, wants Friday."</p><p class="sub">Saved as a lead · <b>new</b> · voicemail written out below</p></div>'
        + '<div class="lsec cy">🎙 Voicemail</div>'
        + '<div class="gcard"><p class="lbl"><b>"Hey, it\'s Marcus — looking for four all-weathers on the F-150, Friday if you can."</b></p><p class="sub">0:12 · written out by Ledger the moment it landed</p></div>'
        + '<div class="setrow"><span class="ic" style="color:var(--gold)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg></span><div><small>Automations</small><b style="font-size:12px">Front Desk · Appointment reminders · Auto-text</b></div><span class="go" style="color:var(--cyan);font-size:11px;font-weight:800">Turn on / off</span></div>'
        + '</div>'
    )
    return '<div class="phonewrap"><div class="phoneframe">' + screen("phone", lbar() + body + apptabs(3, (3, 1))) + '</div></div>'

def calendar_screen(next_up=True, runsheet=True, crew=False):
    body = '<div class="lbody">'
    if next_up:
        body += ('<div class="gcard em"><div class="eb"><b style="color:var(--emerald)">● Next up</b><span class="r" style="color:var(--emerald)">→</span></div>'
                 '<p class="big">in 2 hr 14 min</p><p class="lbl" style="font-size:14px;font-weight:700;color:#fff;margin-top:4px">4 new tires — Dylan Reyes · F-150</p>'
                 '<p class="sub">🕐 12:30 PM – 1:30 PM &nbsp;&nbsp; 🏷 Bay 1</p></div>')
    body += ('<div class="g3">'
             '<div class="gcard cy"><p class="big" style="color:var(--cyan)">2</p><p class="lbl">Today</p><p class="sub" style="color:var(--cyan)">all wrapped</p></div>'
             '<div class="gcard em"><p class="big" style="color:var(--emerald)">7</p><p class="lbl">This week</p><p class="sub" style="color:var(--emerald)">Wed ×2</p></div>'
             '<div class="gcard mg"><p class="big" style="color:var(--magenta)">7</p><p class="lbl">This month</p><p class="sub" style="color:var(--magenta)">4 booked days</p></div>'
             '</div>')
    if runsheet:
        body += ('<div class="gcard"><div class="eb"><b style="color:var(--cyan)">📋 Today\'s run sheet</b></div>'
                 '<div class="lrow"><span class="t">6:15 PM</span><span class="bar"></span>Mount &amp; balance — Sarah Mitchell<span class="v">✓</span></div>'
                 '<div class="lrow"><span class="t">7:45 PM</span><span class="bar"></span>Rotation — Foothills Metals #7<span class="v">✓</span></div>'
                 '<div class="lrow" style="color:var(--cyan)"><span class="t">● Now</span><span class="bar"></span>10:15 PM<span class="v dim"></span></div></div>')
    if crew:
        body += ('<div class="gcard or"><div class="eb"><b style="color:var(--orange)">👷 Crew today</b><span class="r">2 clocked in</span></div>'
                 '<div class="lrow"><span class="t">7:02 AM</span><span class="bar"></span>Jordan — clocked in · Bay 2<span class="v">on job</span></div>'
                 '<div class="lrow"><span class="t">7:11 AM</span><span class="bar"></span>Priya — en route · Foothills Metals<span class="v warn">ETA 9 min</span></div>'
                 '<div class="lrow"><span class="t">Day sheet</span><span class="bar"></span>Sent 6:30 AM · 2 jobs each<span class="v">✓</span></div></div>')
    body += '</div>'
    return '<div class="phonewrap"><div class="phoneframe">' + screen("calendar", lbar() + ltitle("Calendar") + body + apptabs(2)) + '</div></div>'

def finance_overview_screen():
    body = ('<div class="lbody">'
            '<div class="gcard em"><div class="eb"><b style="color:var(--emerald)">💵 Sales</b><span class="r">Live from QuickBooks</span></div>'
            '<p class="lbl">This month</p><p class="big">$48,250.00</p>'
            '<p class="sub" style="color:var(--cyan);font-weight:700">Mon 24 · $3,260.10</p>'
            '<div class="spark"><i style="height:30%"></i><i style="height:22%"></i><i style="height:48%"></i><i style="height:35%"></i><i style="height:26%"></i><i class="hi" style="height:100%"></i><i style="height:40%"></i><i style="height:18%"></i><i style="height:52%"></i><i style="height:33%"></i><i style="height:60%"></i><i style="height:44%"></i><i style="height:38%"></i><i style="height:70%"></i></div>'
            '<div class="sparklbl"><span>2 weeks ago</span><span>Today</span></div></div>'
            '<div class="g2">'
            '<div class="gcard cy"><p class="lbl" style="color:var(--cyan);font-weight:700">Month over month</p><p class="big md">+12%</p><p class="sub">vs same point last month</p></div>'
            '<div class="gcard mg"><p class="lbl" style="color:var(--magenta);font-weight:700">Year over year</p><p class="big md">+31%</p><p class="sub">vs same point last year</p></div>'
            '<div class="gcard em"><p class="lbl" style="color:var(--emerald);font-weight:700">Average sale</p><p class="big md">$2,115.40</p><p class="sub">23 invoices this month</p></div>'
            '<div class="gcard go"><p class="lbl" style="color:var(--gold);font-weight:700">Forecast</p><p class="big md">$61,400</p><p class="sub">month-end run rate</p></div>'
            '</div></div>')
    return '<div class="phonewrap"><div class="phoneframe">' + screen("finance", lbar() + ltitle("Finance") + FIN_PILL(0) + body + apptabs(1)) + '</div></div>'

def finance_profit_screen():
    body = ('<div class="lbody">'
            '<div class="gcard em"><div class="eb"><b style="color:var(--emerald)">📈 Profit today</b><span class="r">Sell − cost</span></div><p class="big">$1,184.00</p><p class="sub">Sold <b>$3,260.10</b> · cost <b>$2,076.10</b> · 36% margin</p></div>'
            '<div class="gcard rd"><div class="eb"><b style="color:var(--red)">Needs cost · 2</b></div>'
            '<div class="lrow">#3271 · Riverside Contracting<span class="v warn">no supplier invoice yet</span></div>'
            '<div class="lrow">#3268 · Dylan Reyes · 4 tires<span class="v warn">match 1 of 2</span></div></div>'
            '<div class="gcard"><div class="eb"><b style="color:var(--cyan)">Cost of operations</b><span class="r">this month</span></div>'
            '<div class="lrow">Tires &amp; parts<span class="v dim">$28,410</span></div><div class="lrow">Shop supplies<span class="v dim">$1,240</span></div><div class="lrow">Subscriptions<span class="v dim">$612</span></div></div>'
            '</div>')
    return '<div class="phonewrap"><div class="phoneframe">' + screen("finance", lbar() + ltitle("Profit") + FIN_PILL(1) + body + apptabs(1)) + '</div></div>'

def finance_receipts_screen():
    body = ('<div class="lbody">'
            '<div class="gcard or"><div class="eb"><b style="color:var(--orange)">📬 Receipt Radar</b><span class="r">Gmail · scanning</span></div><p class="big md">3 new receipts</p><p class="sub">Pulled from your inbox this morning · nothing typed</p></div>'
            '<div class="gcard"><div class="eb"><b>Foothills Auto Supply</b><span class="r" style="color:var(--dim)">Today 8:12</span></div>'
            '<div class="lrow">Category<span class="v dim">Shop Supplies</span></div><div class="lrow">GST<span class="v dim">$4.00</span></div><div class="lrow">Total<span class="v">$84.00</span></div>'
            '<div class="arow" style="margin-top:8px"><span class="ab confirm">File it</span><span class="ab cancel">Edit</span></div></div>'
            '<div class="gcard"><div class="eb"><b>Prairie Tire Distributors</b><span class="r" style="color:var(--dim)">Yesterday</span></div><div class="lrow">4 × 275/65R18 all-weather<span class="v">$812.40</span></div><p class="sub">Matched to invoice #3268 · profit updated</p></div>'
            '<div class="setrow"><span class="ic" style="color:var(--cyan)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/></svg></span><div><b>Snap a paper receipt</b><small>Camera → read → filed</small></div><span class="go">›</span></div>'
            '</div>')
    return '<div class="phonewrap"><div class="phoneframe">' + screen("finance", lbar() + ltitle("Receipts") + FIN_PILL(2) + body + apptabs(1)) + '</div></div>'

def customers_directory_screen():
    body = ('<div class="lbody">'
            '<div class="gcard cy"><div class="eb"><b style="color:var(--cyan)">👥 Customers</b><span class="r">Live from QuickBooks</span></div><p class="lbl">Customer revenue</p><p class="big">$20,214.50</p></div>'
            '<div class="g2">'
            '<div class="gcard cy"><p class="lbl" style="color:var(--cyan);font-weight:700">On file</p><p class="big md">184</p><p class="sub">all reachable by phone or email</p></div>'
            '<div class="gcard pu"><p class="lbl" style="color:var(--purple);font-weight:700">Buyers</p><p class="big md">131</p><p class="sub">has an invoice on record</p></div>'
            '<div class="gcard em"><p class="lbl" style="color:var(--emerald);font-weight:700">Owing</p><p class="big md">$890.00</p><p class="sub">2 customers, both texted</p></div>'
            '<div class="gcard go"><p class="lbl" style="color:var(--gold);font-weight:700">Reviews asked</p><p class="big md">12</p><p class="sub">9 came back five-star</p></div>'
            '</div>'
            '<div class="gcard go"><div class="eb"><b style="color:var(--gold)">💬 Ask for a review</b><span class="r">1 ready</span></div><p class="lbl" style="font-size:14px;font-weight:700;color:#fff">Recent customers worth asking</p>'
            '<div class="setrow" style="margin-top:8px"><span class="av" style="width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#fbbf24,#fb923c);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;color:#111">DR</span><div><small>Ask next</small><b>Dylan Reyes</b><small>555-0100 · Client Hub open</small></div><span class="go" style="color:var(--gold)">→</span></div></div>'
            '</div>')
    return '<div class="phonewrap"><div class="phoneframe">' + screen("customers", lbar() + ltitle("Customers") + CUST_PILL(0) + body + apptabs(4)) + '</div></div>'

def google_reviews_screen():
    body = ('<div class="lbody">'
            '<div class="gcard go"><div class="eb"><b style="color:var(--gold)">⭐ Google reviews</b><span class="r">Live · Google</span></div><p class="big">4.9 <small style="font-size:14px;color:var(--gold)">★★★★★</small></p><p class="sub">214 reviews · <b>1 waiting for your reply</b></p></div>'
            '<div class="gcard mg"><div class="eb"><b style="color:var(--magenta)">New · 2h ago</b><span class="r" style="color:var(--gold)">★★★★★</span></div><p class="lbl">"In and out in 40 minutes, price was exactly what they quoted. Great crew."</p><p class="sub">— Sarah M.</p>'
            '<div class="amsg ai" style="margin-top:9px;max-width:100%;font-size:12px">Thanks Sarah — quoted is what you pay, always. See you at the next rotation!</div>'
            '<div class="arow" style="margin-top:8px"><span class="ab confirm">Approve &amp; publish</span><span class="ab cancel">Edit</span></div></div>'
            '<div class="gcard"><div class="eb"><b>Review intelligence</b></div>'
            '<div class="barrow"><b>5★</b><div class="tr"><i style="width:90%"></i></div><em>9</em></div><div class="barrow"><b>4★</b><div class="tr"><i style="width:10%"></i></div><em>1</em></div><div class="barrow"><b>3★</b><div class="tr"><i style="width:0"></i></div><em>0</em></div>'
            '<p class="sub" style="margin-top:8px">9 of your last 10 reviews are five-star. Every one has an owner reply.</p></div>'
            '</div>')
    return '<div class="phonewrap"><div class="phoneframe">' + screen("customers", lbar() + ltitle("Reviews") + CUST_PILL(1) + body + apptabs(4)) + '</div></div>'

def clienthub_screen():
    body = ('<div class="lbody">'
            '<div class="custcard" style="background:linear-gradient(135deg,rgba(168,85,247,.2),rgba(58,200,245,.14));border-color:rgba(168,85,247,.4)"><div class="who"><span class="av" style="background:linear-gradient(135deg,#a855f7,#3b82f6)">FM</span><div><h4>Foothills Metals</h4><div class="meta">Fleet · 14 units · Net 30 · ap@foothillsmetals.ca</div></div></div>'
            '<div class="acts" style="margin-top:10px"><span class="pri">🔗 Client Hub</span><span>📞 Call</span><span>🧾 Invoice</span></div>'
            '<div class="foot">Portal opened <b>3× this week</b><span class="r">No login needed</span></div></div>'
            + CUST_PILL(0, rev=0)
            + '<div class="gcard pu"><div class="eb"><b style="color:var(--purple)">What they see in their hub</b><span class="r">Live</span></div>'
            '<div class="lrow">Balance owing<span class="v warn">$1,286.25</span></div><div class="lrow">Open estimate #E-114<span class="v" style="color:var(--cyan)">Approve in 1 tap</span></div><div class="lrow">Next appointment<span class="v dim">Thu 8:00 AM</span></div><div class="lrow">Service history<span class="v dim">41 visits</span></div></div>'
            '<div class="gcard em"><div class="eb"><b style="color:var(--emerald)">✓ Approved just now</b><span class="r">from the hub</span></div><p class="lbl">Estimate #E-113 · 2 × 11R22.5 drive · Unit 118</p><p class="sub">Customer tapped Approve at 7:42 AM — job is on the calendar</p></div>'
            '</div>')
    return '<div class="phonewrap"><div class="phoneframe">' + screen("customers", lbar() + ltitle("Customers") + body + apptabs(4)) + '</div></div>'

def ask_ledger_screen():
    body = ('<div class="lbody">'
            '<div class="gcard pu"><div class="askhead"><b><i></i>Ask Ledger</b><span class="lv"><i></i>Live</span></div>'
            '<div class="appchat" style="padding:4px 0 0">'
            '<div class="amsg me">How did we do this week?</div>'
            '<div class="amsg ai">$11,840 in sales across 9 invoices — up 14% on last week. Profit is $3,910 after matched costs. Two invoices still need a supplier cost.</div>'
            '<div class="acard"><h4>Wants a decision</h4><div class="cust">Chase the 2 overdue invoices ($890)?</div><div class="arow"><span class="ab confirm">Text both</span><span class="ab cancel">Not now</span></div></div>'
            '</div>'
            '<div class="acomposer" aria-hidden="true"><span class="field">Ask Ledger anything…</span><span class="send">↑</span></div>'
            '<div class="chips" aria-hidden="true"><span><i style="background:var(--emerald)"></i>Profit today</span><span><i style="background:var(--gold)"></i>Reply to review</span><span><i style="background:var(--orange)"></i>Who owes me?</span><span><i style="background:var(--blue)"></i>Missed calls</span></div>'
            '</div></div>')
    return '<div class="phonewrap"><div class="phoneframe">' + screen("home", lbar(AVATAR) + body + apptabs(0)) + '</div></div>'

# ---------- feature map sections ----------
TAB_ICONS = {}
for i, key in enumerate(["ledger", "finance", "calendar", "phone", "customers"]):
    m = re.search(r'<svg viewBox="0 0 24 24">(<path[^>]*>)</svg>', APPTABS_SRC.split("<span")[i + 1])
    TAB_ICONS[key] = f'<svg viewBox="0 0 24 24">{m.group(1)}</svg>'

TABMAP = f'''
<section id="app" class="tight">
  <div class="wrap">
    <div class="oshead"><span class="dash"></span><span class="code">Ledger OS // In the app</span></div>
    <h2 class="sectitle">Five tabs. <span class="grad">Everything in plain sight.</span></h2>
    <p class="subtext">This is the whole app — every tab and every lane inside it, exactly as it ships on iPhone, Android and the web today. Nothing here is a roadmap.</p>
    <div style="height:34px"></div>
    <div class="tabmap">
      <a class="tm cy" href="/features/ai/"><span class="ti">{TAB_ICONS["ledger"]}</span><h3>Ledger</h3><div class="lanes"><span>Home</span><span>Ask Ledger</span><span>Live voice</span></div>
        <ul><li><b>Business pulse</b> — sales, profit, bookings and calls for today, at a glance</li><li><b>Ask Ledger</b> — type or talk; answers come from your live books</li><li><b>Attention center</b> — what needs you, ranked, with a one-tap action</li><li><b>Reviews pulse</b>, tomorrow's day, inbox and shortcuts</li><li><b>Business profile &amp; settings</b> — connections, branding, team</li></ul><span class="more">The AI Copilot →</span></a>
      <a class="tm em" href="/features/invoicing/"><span class="ti">{TAB_ICONS["finance"]}</span><h3>Finance</h3><div class="lanes"><span>Overview</span><span>Profit</span><span>Receipts</span></div>
        <ul><li><b>Overview</b> — live sales, month-over-month, year-over-year, average sale, forecast</li><li><b>Profit</b> — sell minus real supplier cost per invoice, cost of operations, "needs cost" flags</li><li><b>Receipts</b> — Receipt Radar from Gmail plus snap-a-receipt, filed in a tap</li><li>Invoices and estimates drafted by conversation, posted on your confirm</li><li>Card payments, mark-paid, print, reminders, who-owes-you watch</li></ul><span class="more">Invoicing &amp; getting paid →</span></a>
      <a class="tm go" href="/features/booking/"><span class="ti">{TAB_ICONS["calendar"]}</span><h3>Calendar</h3><div class="lanes"><span>Next up</span><span>Run sheet</span><span>Crew</span></div>
        <ul><li><b>Next up</b> — the countdown to your next job, who, what, which bay</li><li><b>Today · this week · this month</b> tiles and busiest-days chart</li><li><b>Today's run sheet</b> — every job in order, ticked as it's done</li><li>Public booking page with conflict checks; night-before reminder texts</li><li><b>Crew Command</b> — dispatch, day sheets, live job links, punch-clock time cards</li></ul><span class="more">Booking &amp; Crew →</span></a>
      <a class="tm bl" href="/features/phone/"><span class="ti">{TAB_ICONS["phone"]}</span><h3>Phone</h3><div class="lanes"><span>Needs You</span><span>Today</span><span>Auto</span></div>
        <ul><li><b>Needs You</b> — the customer waiting on you, with Call · Text · Book right on the card</li><li><b>Today</b> — every call, text and voicemail, written out</li><li><b>Auto</b> — Front Desk, missed-call auto-text, appointment reminders: on or off per lane</li><li>A dedicated business number, or keep the one you have</li><li>Missed caller saved as a lead the same second</li></ul><span class="more">Business Phone →</span></a>
      <a class="tm mg" href="/features/client-hub/"><span class="ti">{TAB_ICONS["customers"]}</span><h3>Customers</h3><div class="lanes"><span>Directory</span><span>Reviews</span><span>To-do</span></div>
        <ul><li><b>Directory</b> — every customer, revenue, owing, live from your books</li><li><b>Client Hub</b> — a personal portal per customer: balance, invoices, one-tap quote approval</li><li><b>Reviews</b> — Google reviews with a reply drafted in your voice, published on your approval</li><li><b>Ask for a review</b> — the recent customers worth asking, one tap</li><li><b>To-do</b> — follow-ups and call lists that keep score</li></ul><span class="more">Client Hub →</span></a>
    </div>
    <div class="fullfeat">
      <div><span class="tick">✓</span><span><b>Live QuickBooks answers</b> — text or voice, from your real books</span></div>
      <div><span class="tick">✓</span><span><b>Built-in books</b> — numbered, taxed invoicing without QuickBooks</span></div>
      <div><span class="tick">✓</span><span><b>Invoice &amp; estimate drafting</b> — tap-to-confirm, never auto-posted</span></div>
      <div><span class="tick">✓</span><span><b>Card payments</b> by Stripe with hosted pay pages</span></div>
      <div><span class="tick">✓</span><span><b>Estimate share pages</b> — accept or decline in one tap</span></div>
      <div><span class="tick">✓</span><span><b>Profit per invoice</b> — sell minus matched supplier cost</span></div>
      <div><span class="tick">✓</span><span><b>Receipt Radar</b> — receipts pulled from Gmail, plus photo receipts</span></div>
      <div><span class="tick">✓</span><span><b>Mark paid, print, remind</b> — and a live who-owes-you watch</span></div>
      <div><span class="tick">✓</span><span><b>Crew dispatch</b> — roster, one-tap dispatch, morning day sheets</span></div>
      <div><span class="tick">✓</span><span><b>Crew live links</b> — job status and turn-by-turn, no app install</span></div>
      <div><span class="tick">✓</span><span><b>Punch-clock time cards</b> — server-stamped, overtime rules, payroll CSV</span></div>
      <div><span class="tick">✓</span><span><b>Client Hub portals</b> — live balance, invoices, history, quote approval</span></div>
      <div><span class="tick">✓</span><span><b>Public booking page</b> with calendar conflict checking</span></div>
      <div><span class="tick">✓</span><span><b>Night-before reminder texts</b> — automatic, per appointment</span></div>
      <div><span class="tick">✓</span><span><b>Dedicated business number</b> — or forward the one you have</span></div>
      <div><span class="tick">✓</span><span><b>Same-second missed-call auto-text</b> — business-hours and after-hours templates</span></div>
      <div><span class="tick">✓</span><span><b>Voicemail written out</b> — read it, don't play it</span></div>
      <div><span class="tick">✓</span><span><b>Front Desk</b> — Ledger answers texts and voicemails when you can't</span></div>
      <div><span class="tick">✓</span><span><b>Leads pipeline</b> — every missed caller saved, with a callback list</span></div>
      <div><span class="tick">✓</span><span><b>Google review replies</b> — drafted in your voice, you approve every word</span></div>
      <div><span class="tick">✓</span><span><b>Ask for a review</b> — the right customers, one tap</span></div>
      <div><span class="tick">✓</span><span><b>Push notifications</b> — a customer texted, a review landed, a job needs cover</span></div>
      <div><span class="tick">✓</span><span><b>Business memory &amp; Advisor Mode</b> — it remembers how you run things</span></div>
      <div><span class="tick">✓</span><span><b>iPhone · Android · web</b> — one account, same app everywhere</span></div>
      <div><span class="tick">✓</span><span><b>No per-seat fees</b> — crew and customers are always free</span></div>
    </div>
  </div>
</section>
'''

def tabstrip(here):
    rows = [
        ("cy", "ledger", "Ledger", "Ask anything · business pulse · attention center", "/features/ai/"),
        ("em", "finance", "Finance", "Overview · Profit · Receipts · invoicing", "/features/invoicing/"),
        ("go", "calendar", "Calendar", "Next up · run sheet · booking · crew", "/features/booking/"),
        ("bl", "phone", "Phone", "Needs You · Today · Auto", "/features/phone/"),
        ("mg", "customers", "Customers", "Directory · Reviews · To-do · Client Hub", "/features/client-hub/"),
    ]
    s = '\n<section class="tight" data-b75="tabstrip">\n  <div class="wrap">\n    <div class="oshead"><span class="dash"></span><span class="code">In the app // where this lives</span></div>\n    <div class="tabstrip">\n'
    for cls, key, name, sub, href in rows:
        h = " here" if key == here else ""
        tag = '<span class="here-tag">THIS PAGE</span>' if key == here else ""
        s += f'      <a class="{cls}{h}" href="{href}">{tag}<span class="tn">{TAB_ICONS[key]}{name}</span><small>{sub}</small></a>\n'
    s += '    </div>\n    <p class="subtext" style="margin-top:18px;font-size:14px">Every tab and lane, <a href="/#app" style="color:var(--cyan)">laid out in full on the home page →</a></p>\n  </div>\n</section>\n'
    return s

# ---------- page edits ----------
def bump_css(html):
    return re.sub(r'styles\.css\?v=\d+', f'styles.css?v={CSS_V}', html)

def add_nav_link(html):
    if 'href="/#app">In the app' in html:
        return html
    return html.replace('<a href="#pricing">Pricing</a>', '<a href="/#app">In the app</a>\n        <a href="#pricing">Pricing</a>', 1) \
               .replace('<a href="/#pricing">Pricing</a>', '<a href="/#app">In the app</a>\n        <a href="/#pricing">Pricing</a>', 1)

def insert_after_introhero(html, fragment):
    if 'data-b75="tabstrip"' in html:
        return html
    a = html.find('class="introhero"')
    if a < 0:
        a = html.find('<div class="hero">')
    b = html.find("\n<section", a)
    return html[:b] + fragment + html[b:]

def insert_phone_in_introhero(html, phone):
    if 'class="phoneframe"' in html:
        return html
    a = html.find('class="introhero"')
    c = html.find('class="cta-row"', a)
    e = html.find("</div>", c) + len("</div>")
    return html[:e] + "\n    " + phone + html[e:]

def replace_apphead(html, new_head, occurrence=1, tint=None):
    """Swap the console-style header for the quiet build-75 header; tint the screen."""
    a, b = find_block(html, '<div class="apphead">', occurrence)
    html = html[:a] + new_head + html[b:]
    if tint:
        s = html.rfind('<div class="screen">', 0, a)
        html = html[:s] + f'<div class="screen tint-{tint}">' + html[s + len('<div class="screen">'):]
    return html

def edit(path, fn):
    p = ROOT / path
    src = p.read_text()
    out = fn(src)
    out = bump_css(add_nav_link(out))
    if out != src:
        p.write_text(out)
        print("updated", path, len(src), "->", len(out))
    else:
        print("unchanged", path)

def do_index(h):
    if 'tint-home' not in h:
        hstage = extract_block(h, '<div class="hstage" id="heroStage">')
        stabs = extract_block(h, '<div class="stabs" id="heroTabs">')
        h = replace_block(h, '<div class="phonewrap"><div class="phoneframe floaty">', home_hero_screen(hstage, stabs))
    if 'tint-customers' not in h:
        appbody2 = extract_block(h, '<div class="appbody2">')
        h = replace_block(h, '<div class="phoneframe"><div class="screen">', reviews_screen(appbody2))
    if 'id="app"' not in h:
        i = h.find('<section class="tight">\n  <div class="wrap">\n    <div class="showcase">')
        h = h[:i] + TABMAP.lstrip("\n") + "\n" + h[i:]
    h = h.replace("Seven pillars, each deep enough", "Eight pillars, each deep enough", 1)
    return h

def do_feature(page, here, build_fn=None, head=None, tint=None):
    def fn(h):
        if build_fn:
            if f"tint-{tint}" not in h:
                h = replace_block(h, '<div class="phonewrap"><div class="phoneframe">', build_fn())
        else:
            if f"tint-{tint}" not in h:
                h = replace_apphead(h, head, 1, tint)
        return insert_after_introhero(h, tabstrip(here))
    edit(page, fn)

def do_invoicing(h):
    if "tint-finance" not in h:
        h = replace_apphead(h, lbar() + ltitle("Finance") + FIN_PILL(0), 1, "finance")
    if "tint-home" not in h:
        h = replace_apphead(h, lbar(AVATAR), 1, "home")
    return insert_after_introhero(h, tabstrip("finance"))

def do_integration(page, here, build_fn):
    def fn(h):
        h = insert_phone_in_introhero(h, build_fn())
        return insert_after_introhero(h, tabstrip(here))
    edit(page, fn)

def main():
    edit("index.html", do_index)
    do_feature("features/ai/index.html", "ledger", build_fn=ask_ledger_screen, tint="home")
    do_feature("features/phone/index.html", "phone", build_fn=phone_needsyou_screen, tint="phone")
    do_feature("features/booking/index.html", "calendar", build_fn=lambda: calendar_screen(next_up=True, runsheet=True), tint="calendar")
    do_feature("features/crew/index.html", "calendar", build_fn=lambda: calendar_screen(next_up=False, runsheet=True, crew=True), tint="calendar")
    do_feature("features/client-hub/index.html", "customers", build_fn=clienthub_screen, tint="customers")
    edit("features/invoicing/index.html", do_invoicing)
    do_integration("integrations/quickbooks/index.html", "finance", finance_overview_screen)
    do_integration("integrations/gmail/index.html", "finance", finance_receipts_screen)
    do_integration("integrations/google-calendar/index.html", "calendar", lambda: calendar_screen())
    do_integration("integrations/google-business/index.html", "customers", google_reviews_screen)
    for p in ["support/index.html", "privacy/index.html", "book.html"]:
        if (ROOT / p).exists():
            edit(p, lambda h: h)  # nav link + css bump only
    edit("support/index.html", lambda h: insert_after_introhero(h, tabstrip("")) if "introhero" in h else h)

if __name__ == "__main__":
    main()
