// Riply v1.0
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useUser } from "@clerk/clerk-react";
import { useClerkAuth } from "./hooks/useClerkAuth";
import { useCurrentUser, deriveAvatarColor } from "./hooks/useCurrentUser";
import { useNotifications } from "./hooks/useNotifications";
import { useChat } from "./hooks/useChat";
import { useChats } from "./hooks/useChats";
import { useGroupActivity } from "./hooks/useGroupActivity";
import { useEvents, useEvent } from "./hooks/useEvents";
import { parseEventPrice } from "./lib/eventPrice";
import { useUserInteractions } from "./hooks/useUserInteractions";
import { usePosts } from "./hooks/usePosts";
import { useComments } from "./hooks/useComments";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;
import { useGroups } from "./hooks/useGroups";
import { useSpaces } from "./hooks/useSpaces";
import { uploadImage, safeExt } from "./hooks/useUpload";
import { supabase } from "./lib/supabase";
import QRCode from "qrcode";
import jsQR from "jsqr";

// ─────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────
// Add to Calendar — generates an ICS download, falls back to Google Calendar URL
function addToCalendar({ title, location, description, dateStr, timeStr, durationMins = 60 }) {
  try {
    // Parse date + time into a JS Date
    const base = dateStr ? new Date(dateStr) : new Date();
    if (timeStr) {
      const m = String(timeStr).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (m) {
        let h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        if (m[3]) { if (/pm/i.test(m[3]) && h < 12) h += 12; if (/am/i.test(m[3]) && h === 12) h = 0; }
        base.setHours(h, min, 0, 0);
      }
    }
    const end = new Date(base.getTime() + durationMins * 60000);
    const fmt = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
      `SUMMARY:${title || 'Event'}`,
      `DTSTART:${fmt(base)}`,
      `DTEND:${fmt(end)}`,
      location ? `LOCATION:${location}` : '',
      description ? `DESCRIPTION:${description}` : '',
      'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(title || 'event').replace(/\s+/g,'-')}.ics`;
    a.click(); URL.revokeObjectURL(url);
  } catch {
    // fallback: Google Calendar
    const q = encodeURIComponent(title || 'Event');
    window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${q}`, '_blank');
  }
}

// ProfileScreen (Settings) fully unmounts when navigating to one of its
// sub-pages (My Tickets, Help Center, etc.) since only the top of the nav
// stack renders -- so its scroll position was always lost, resetting to the
// top on every return. Module-scope rather than component state/a ref passed
// down from the app root, since that would mean threading it through the
// whole navigate/goBack stack just for this one screen; this is reset on a
// full page reload, which is the expected/acceptable boundary for it.
let profileScrollTop = 0;

// Format any parseable date value as "13 Jan 2026" (the app-wide default),
// falling back to the raw value if it isn't a real date, or to `empty` (a
// caller-supplied placeholder, "" by default) if there's no value at all.
function fmtDate(raw, empty = '') {
  if (!raw) return empty;
  const d = new Date(raw);
  if (isNaN(d)) return raw;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Renders plain text with any http(s) URLs turned into clickable links --
// post bodies are stored/rendered as plain text, so a pasted link previously
// just sat there unclickable.
const URL_RE = /(https?:\/\/[^\s]+)/g;
function Linkify({ text }) {
  if (!text) return null;
  // A capturing group in the split pattern puts each matched URL at an odd
  // index and the surrounding plain text at even indices, so no separate
  // regex test (stateful/unreliable with the `g` flag) is needed to tell them
  // apart -- plain strings render fine directly inside an array, no Fragment
  // wrapper required.
  return String(text).split(URL_RE).map((part, i) => i % 2 === 1
    ? <a key={i} href={part} target="_blank" rel="noopener noreferrer"
        style={{ color: C.primary, wordBreak: 'break-all' }}
        onClick={e => e.stopPropagation()}>{part}</a>
    : part
  );
}

// Convert "HH:MM" (24-hr) to "H:MM AM/PM". Passes through anything else.
function fmt12(t) {
  if (!t) return t;
  const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

// Format a stored time_range string ("HH:MM – HH:MM") to 12-hr.
function fmtRange(r) {
  if (!r) return r;
  return r.split(' – ').map(fmt12).join(' – ');
}

const C = {
  primary: '#0098F0', bright: '#19BFFF',
  grad: 'linear-gradient(135deg,#19BFFF,#0098F0)',
  ink: '#0E1726', body: '#1A2233', muted: '#5B6473', subtle: '#9AA3B2',
  pageBg: '#F4F6FA', card: '#FFFFFF', border: '#E8EBF0', chip: '#F1F3F7',
  divider: '#EEF0F4', danger: '#E5484D', success: '#15A34A',
};

const THEME = {
  social:   { grad:'linear-gradient(135deg,#FF5A8A,#FF8A3D)', label:'Social',   org:'#FF5A8A' },
  career:   { grad:'linear-gradient(135deg,#2F6BFF,#6C4DF2)', label:'Career',   org:'#2F6BFF' },
  sports:   { grad:'linear-gradient(135deg,#10B981,#06B6D4)', label:'Sports',   org:'#10B981' },
  academic: { grad:'linear-gradient(135deg,#7C5CFF,#B06BFF)', label:'Academic', org:'#7C5CFF' },
  festival: { grad:'linear-gradient(135deg,#FF6B6B,#FFB347)', label:'Festival', org:'#FF6B6B' },
};


// ─────────────────────────────────────────────────────────────
// RIPLY LOGO MARK  (matches the uploaded brand asset)
// ─────────────────────────────────────────────────────────────
function RiplyMark({ size = 32, w, h, white = false, blue = false }) {
  // logo is 220×110 (2:1). w/h override size for wide display use.
  const imgW = w ?? size;
  const imgH = h ?? size;
  return (
    <img
      src="/logo.png"
      alt="Riply"
      width={imgW}
      height={imgH}
      style={{
        objectFit: 'contain',
        display: 'block',
        filter: white
          ? 'brightness(0) invert(1)'
          : blue
          ? 'brightness(0) saturate(100%) invert(68%) sepia(72%) saturate(400%) hue-rotate(164deg) brightness(103%)'
          : 'none',
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────
const EVENTS = [
  { id:1, trending:true, title:'Karaoke Night', org:'VW Social Club', orgInitial:'V', location:'3rd Floor, University Centre', date:'Jan 15 · 8:00 PM', fullDate:'Tuesday, January 15, 2026', timeRange:'8:00 PM – 1:00 AM (CST)', venue:'UMSU University Centre', room:'3rd Floor · Multipurpose Room', price:'Free', desc:'Join us for a night of karaoke with other students. Meet new people, show your talent, and enjoy free food & refreshments!', fullDesc:"Karaoke Night is all about music, laughter, and good vibes. Join us for an evening where the stage is open to everyone — whether you're a superstar singer or just here for the fun. Bring your friends, grab the mic, and show us your inner rock star. Free food and refreshments provided.", primary:'social', tags:['social'], badge:'Every Tuesday', likes:312, saves:540, shares:88, attendees:5000, rules:['Have fun and be yourself','Respect all performers','Keep it safe and inclusive','Follow venue guidelines','Respect university policies'] },
];

const SPACES = [
  { id:1, title:'Seasonal Basketball 5v5', desc:'All-skills basketball game · 7 games', location:'ALC · Fridays', participants:9, max:12, time:'8PM', duration:'60 min', price:50, avatarColor:'linear-gradient(135deg,#FF8A3D,#FF5A8A)', avatarInitial:'J', hostText:'Created by Jane Doe', started:false, day:'today', cat:'sports' },
];

const GROUPS = [
  { id:1, name:'History Club', desc:'Explore the stories that shaped our world through talks, archives, and campus walking tours.', count:'2.4K', initial:'H', logoColor:'linear-gradient(135deg,#7C5CFF,#02B6FE)', cat:['culture'], state:'join', members:[{initial:'A',color:'#FF5A8A'},{initial:'J',color:'#0098F0'},{initial:'M',color:'#10B981'}] },
];

const CHATS = [
  { id:1, name:'Campus Community', initial:'C', color:'linear-gradient(135deg,#7C5CFF,#02B6FE)', preview:'Welcome to Riply!', time:'just now', unread:false, unreadCount:0, type:'group', memberCount:1 },
];

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
const fmt = (n) => n >= 1000 ? ((n/1000 >= 10 ? Math.round(n/1000) : Math.round(n/100)/10) + 'K') : String(n);

// ─────────────────────────────────────────────────────────────
// SHARED UI COMPONENTS
// ─────────────────────────────────────────────────────────────

function Toast({ msg }) {
  return (
    <div style={{ position:'absolute', left:16, right:16, bottom:106, zIndex:30, display:'flex', alignItems:'center', gap:10, background:C.ink, color:'#fff', borderRadius:14, padding:'13px 15px', boxShadow:'0 10px 24px rgba(14,23,38,0.35)', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={C.bright} strokeWidth="2"/><path d="m8 12 2.5 2.5L16 9" stroke={C.bright} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      <span style={{ flex:1, fontSize:13, fontWeight:600 }}>{msg}</span>
    </div>
  );
}

// A single shimmering placeholder block -- the base unit every skeleton
// loader below is built from. The shine sweeps left-to-right via a
// background-position animation (defined once, globally, in RiplyApp's font
// injection effect) rather than transform, so many of these on screen at
// once don't each need their own compositing layer.
function Shimmer({ width = '100%', height = 14, radius = 8, style }) {
  return (
    <div style={{
      width, height, borderRadius: radius,
      background: 'linear-gradient(90deg, #ECEFF3 25%, #F6F8FA 37%, #ECEFF3 63%)',
      backgroundSize: '400% 100%',
      animation: 'riplyShimmer 1.4s ease infinite',
      ...style,
    }} />
  );
}

// Generic row skeleton -- an avatar circle + two lines -- for anything shaped
// like a list (chats, notifications, group/space cards in a vertical list).
function SkeletonRows({ count = 4 }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ display:'flex', gap:12, alignItems:'center', background:C.card, borderRadius:18, boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:'13px 14px' }}>
          <Shimmer width={46} height={46} radius={999} />
          <div style={{ flex:1, display:'flex', flexDirection:'column', gap:8 }}>
            <Shimmer width="55%" height={13} />
            <Shimmer width="80%" height={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Generic card skeleton -- an image block + title/meta lines -- for feeds of
// bigger cards (events, posts).
function SkeletonCards({ count = 3 }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ background:C.card, borderRadius:20, boxShadow:'0 4px 16px rgba(16,24,40,0.06)', overflow:'hidden' }}>
          <Shimmer width="100%" height={150} radius={0} />
          <div style={{ padding:14, display:'flex', flexDirection:'column', gap:8 }}>
            <Shimmer width="70%" height={15} />
            <Shimmer width="45%" height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Twitter/Instagram-style swipe-left-to-reveal-delete. Wraps a row (chat,
// notification, etc.) so a horizontal drag reveals a red delete action
// underneath, while a vertical drag falls through untouched so the
// surrounding list still scrolls normally. Uses Pointer Events (not Touch
// Events) so the same drag-to-reveal works with a mouse too -- rows that rely
// on this as their only delete affordance (e.g. chats) would otherwise be
// undeletable on desktop, since there'd be no touch gesture available and no
// separate button.
function SwipeToDeleteRow({ children, onDelete, deleteLabel = 'Delete', revealWidth = 76 }) {
  const [dragX, setDragX] = useState(0);
  const startRef = useRef(null);
  const draggingRef = useRef(false);
  const axisRef = useRef(null);

  const onPointerDown = (e) => {
    startRef.current = { x: e.clientX, y: e.clientY, base: dragX };
    axisRef.current = null;
  };
  const onPointerMove = (e) => {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    if (axisRef.current === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axisRef.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (axisRef.current !== 'x') return;
    draggingRef.current = true;
    setDragX(Math.min(0, Math.max(-revealWidth, startRef.current.base + dx)));
  };
  const onPointerUp = () => {
    if (draggingRef.current) {
      setDragX(prev => (prev < -revealWidth / 2 ? -revealWidth : 0));
    }
    startRef.current = null;
    draggingRef.current = false;
    axisRef.current = null;
  };

  return (
    <div style={{ position:'relative', overflow:'hidden', borderRadius:18 }}>
      <div style={{ position:'absolute', top:0, right:0, bottom:0, width:revealWidth, display:'flex' }}>
        <button onClick={() => { onDelete(); setDragX(0); }} aria-label={deleteLabel} style={{
          flex:1, border:'none', background:'#FF3B6B', color:'#fff', fontSize:13.5, fontWeight:800,
          cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
          Delete
        </button>
      </div>
      <div
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
        onClickCapture={e => { if (dragX !== 0) { e.stopPropagation(); setDragX(0); } }}
        style={{ transform:`translateX(${dragX}px)`,
                 transition: draggingRef.current ? 'none' : 'transform .2s ease',
                 touchAction:'pan-y' }}>
        {children}
      </div>
    </div>
  );
}

// Pull-to-refresh: IS the scrollable container (not a wrapper around one),
// so callers just swap their usual `overflowY:'auto'` div for this and pass
// an async onRefresh. Only starts tracking a pull when the container is
// already scrolled to the very top, so it never fights a normal scroll
// gesture partway down the list.
function PullToRefresh({ onRefresh, style, children, onTouchStart: extraStart, onTouchEnd: extraEnd }) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const containerRef = useRef(null);
  const startYRef = useRef(null);
  const draggingRef = useRef(false);
  const THRESHOLD = 64;
  const MAX_PULL = 96;

  const onTouchStart = (e) => {
    extraStart?.(e);
    if (refreshing) return;
    startYRef.current = (containerRef.current?.scrollTop ?? 0) <= 0 ? e.touches[0].clientY : null;
  };
  const onTouchMove = (e) => {
    if (startYRef.current == null || refreshing) return;
    if ((containerRef.current?.scrollTop ?? 0) > 0) { setPullY(0); draggingRef.current = false; return; }
    const dy = e.touches[0].clientY - startYRef.current;
    if (dy <= 0) { setPullY(0); draggingRef.current = false; return; }
    draggingRef.current = true;
    setPullY(Math.min(MAX_PULL, dy * 0.5));
  };
  const onTouchEnd = async (e) => {
    extraEnd?.(e);
    startYRef.current = null;
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (pullY >= THRESHOLD) {
      setRefreshing(true);
      setPullY(THRESHOLD);
      try { await onRefresh?.(); } finally { setRefreshing(false); setPullY(0); }
    } else {
      setPullY(0);
    }
  };

  return (
    <div ref={containerRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      style={{ ...style, overflowY:'auto', overscrollBehavior:'contain' }}>
      <div style={{ height: refreshing ? THRESHOLD : pullY,
                    transition: draggingRef.current ? 'none' : 'height .2s ease',
                    display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
        <div style={{ width:20, height:20, borderRadius:'50%', border:'2.5px solid #E1E6EE',
                      borderTopColor:C.primary,
                      animation: (refreshing || pullY > 8) ? 'riplySpin .8s linear infinite' : 'none',
                      opacity: refreshing ? 1 : Math.min(1, pullY / THRESHOLD) }}/>
        <style>{`@keyframes riplySpin{to{transform:rotate(360deg);}}`}</style>
      </div>
      {children}
    </div>
  );
}

function SearchBar({ placeholder, hint, value, onChange, onFilter }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:11, background:C.chip, borderRadius:18, padding:'11px 11px 11px 15px', boxShadow:'inset 0 0 0 1px rgba(16,24,40,0.04)' }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}><circle cx="11" cy="11" r="7" stroke="#8A93A6" strokeWidth="2"/><path d="m20 20-3.2-3.2" stroke="#8A93A6" strokeWidth="2" strokeLinecap="round"/></svg>
      <div style={{ flex:1, minWidth:0 }}>
        {onChange ? (
          <input value={value||''} onChange={onChange} placeholder={placeholder||'Search…'} style={{ width:'100%', boxSizing:'border-box', border:'none', background:'none', outline:'none', fontSize:15, fontWeight:600, color:C.body, fontFamily:"'Montserrat',-apple-system,sans-serif", padding:0 }} />
        ) : (
          <div style={{ fontSize:15, fontWeight:600, color:C.body }}>{placeholder}</div>
        )}
        {hint && <div style={{ fontSize:12, color:C.subtle, marginTop:3 }}>{hint}</div>}
      </div>
      {onFilter && (
        <button onClick={onFilter} style={{ flexShrink:0, width:40, height:40, border:'none', borderRadius:13, background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 4px 10px rgba(2,162,240,0.32)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <line x1="3" y1="6" x2="10.5" y2="6" stroke="#fff" strokeWidth="1.9" strokeLinecap="round"/>
            <line x1="15.5" y1="6" x2="21" y2="6" stroke="#fff" strokeWidth="1.9" strokeLinecap="round"/>
            <circle cx="13" cy="6" r="2.5" stroke="#fff" strokeWidth="1.9"/>
            <line x1="3" y1="12" x2="7.5" y2="12" stroke="#fff" strokeWidth="1.9" strokeLinecap="round"/>
            <line x1="12.5" y1="12" x2="21" y2="12" stroke="#fff" strokeWidth="1.9" strokeLinecap="round"/>
            <circle cx="10" cy="12" r="2.5" stroke="#fff" strokeWidth="1.9"/>
            <line x1="3" y1="18" x2="13.5" y2="18" stroke="#fff" strokeWidth="1.9" strokeLinecap="round"/>
            <line x1="18.5" y1="18" x2="21" y2="18" stroke="#fff" strokeWidth="1.9" strokeLinecap="round"/>
            <circle cx="16" cy="18" r="2.5" stroke="#fff" strokeWidth="1.9"/>
          </svg>
        </button>
      )}
    </div>
  );
}

function Tabs({ tabs, active, onSelect }) {
  return (
    <div style={{ display:'flex', gap:8, overflowX:'auto', padding:'2px 16px', scrollbarWidth:'none' }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onSelect(t.id)} style={{ flexShrink:0, border:'none', cursor:'pointer', height:38, padding:'0 16px', borderRadius:999, fontSize:13.5, fontWeight:700, whiteSpace:'nowrap', fontFamily:"'Montserrat',-apple-system,sans-serif", transition:'all .15s', background: t.id===active ? C.primary : C.chip, color: t.id===active ? '#fff' : C.muted, boxShadow: t.id===active ? '0 4px 12px rgba(2,162,240,0.34)' : 'none' }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button onClick={onChange} style={{ width:44, height:26, border:'none', borderRadius:999, background: value ? C.primary : '#D1D5DB', cursor:'pointer', position:'relative', transition:'background .2s', flexShrink:0, padding:0 }}>
      <span style={{ position:'absolute', top:3, left: value ? 21 : 3, width:20, height:20, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,0.2)', transition:'left .2s', display:'block' }} />
    </button>
  );
}

function Sheet({ onClose, title, children }) {
  return (
    <>
      <div onClick={onClose} style={{ position:'absolute', inset:0, zIndex:9, background:'rgba(14,23,38,0.45)', backdropFilter:'blur(2px)' }} />
      <div style={{ position:'absolute', left:0, right:0, bottom:0, zIndex:10, background:C.card, borderRadius:'26px 26px 0 0', boxShadow:'0 -12px 40px rgba(0,0,0,0.28)', padding:'10px 18px 32px', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
        <div style={{ width:40, height:5, borderRadius:999, background:'#D4D9E2', margin:'0 auto 16px' }} />
        {title && <div style={{ fontSize:19, fontWeight:800, color:C.ink, marginBottom:16 }}>{title}</div>}
        {children}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// FLOATING SCROLL PILL  (appears when user scrolls down)
// ─────────────────────────────────────────────────────────────
const SCREEN_LABELS = { home:'Explore', spaces:'Spaces', discover:'Discover', messages:'Messages', profile:'Profile' };

function FloatingScrollPill({ visible, screen }) {
  const label = SCREEN_LABELS[screen] || '';
  return (
    <div style={{
      position:'absolute', top:0, left:'50%', zIndex:50, pointerEvents:'none',
      transform:`translateX(-50%) translateY(${visible ? '14px' : '-56px'})`,
      transition:'transform 0.4s cubic-bezier(0.34,1.4,0.64,1), opacity 0.25s ease',
      opacity: visible ? 1 : 0,
    }}>
      <div style={{
        display:'flex', alignItems:'center', gap:10,
        background:'linear-gradient(145deg,rgba(255,255,255,0.96),rgba(228,232,242,0.96))',
        backdropFilter:'blur(24px)', WebkitBackdropFilter:'blur(24px)',
        borderRadius:999,
        border:'1px solid rgba(195,200,215,0.7)',
        boxShadow:'0 6px 24px rgba(0,0,0,0.11), 0 1px 3px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.9)',
        padding:'9px 20px 9px 14px',
        position:'relative', overflow:'hidden',
      }}>
        {/* shimmer sweep */}
        <div style={{
          position:'absolute', top:0, left:'-40%', width:'35%', height:'100%', pointerEvents:'none',
          background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.55),transparent)',
          animation:'pill-shimmer 3s ease-in-out infinite',
        }}/>
        {/* brand dot cluster */}
        <div style={{ display:'flex', gap:3, alignItems:'center' }}>
          <div style={{ width:7, height:7, borderRadius:'50%', background:C.grad, boxShadow:`0 0 6px ${C.primary}55` }}/>
          <div style={{ width:4, height:4, borderRadius:'50%', background:'rgba(0,152,240,0.35)' }}/>
        </div>
        <span style={{ fontSize:15, fontWeight:800, color:'#1A2233', letterSpacing:'-0.3px', lineHeight:1 }}>
          {label}
        </span>
        {/* thin colour accent line along bottom */}
        <div style={{
          position:'absolute', bottom:0, left:'18%', right:'18%', height:2, borderRadius:999,
          background:C.grad, opacity:0.55,
        }}/>
      </div>
    </div>
  );
}

function BottomNav({ screen, setScreen, unreadCount = 0 }) {
  const navColor = (id) => screen === id ? '#02A6F0' : C.subtle;
  const navWeight = (id) => screen === id ? '700' : '600';

  return (
    <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'rgba(255,255,255,0.94)', backdropFilter:'blur(16px)', boxShadow:'0 -1px 0 rgba(16,24,40,0.07)', padding:'11px 6px 24px', display:'flex', justifyContent:'space-around', alignItems:'flex-end', zIndex:5 }}>
      {/* Home */}
      <button onClick={()=>setScreen('home')} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, border:'none', background:'none', cursor:'pointer', width:58 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 11 12 4l8 7" stroke={navColor('home')} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 9.8V19a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1V9.8" stroke={navColor('home')} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span style={{ fontSize:10, fontWeight:navWeight('home'), color:navColor('home'), fontFamily:"'Montserrat',-apple-system,sans-serif" }}>Home</span>
      </button>
      {/* Spaces */}
      <button onClick={()=>setScreen('spaces')} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, border:'none', background:'none', cursor:'pointer', width:58 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="7" r="3.3" stroke={navColor('spaces')} strokeWidth="2"/>
          <circle cx="6" cy="17" r="3.3" stroke={navColor('spaces')} strokeWidth="2"/>
          <circle cx="18" cy="17" r="3.3" stroke={navColor('spaces')} strokeWidth="2"/>
        </svg>
        <span style={{ fontSize:10, fontWeight:navWeight('spaces'), color:navColor('spaces'), fontFamily:"'Montserrat',-apple-system,sans-serif" }}>Spaces</span>
      </button>
      {/* Discover */}
      <button onClick={()=>setScreen('discover')} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, border:'none', background:'none', cursor:'pointer', width:58 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke={navColor('discover')} strokeWidth="2"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" stroke={navColor('discover')} strokeWidth="2" strokeLinejoin="round"/></svg>
        <span style={{ fontSize:10, fontWeight:navWeight('discover'), color:navColor('discover'), fontFamily:"'Montserrat',-apple-system,sans-serif" }}>Discover</span>
      </button>
      {/* Messages */}
      <button onClick={()=>setScreen('messages')} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, border:'none', background:'none', cursor:'pointer', width:58, position:'relative' }}>
        <div style={{ position:'relative' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"
                  stroke={navColor('messages')} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {unreadCount > 0 && (
            <span style={{ position:'absolute', top:-4, right:-6, minWidth:16, height:16, padding:'0 4px', borderRadius:999, background:'#FF3B6B', color:'#fff', fontSize:10, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center' }}>{unreadCount > 99 ? '99+' : unreadCount}</span>
          )}
        </div>
        <span style={{ fontSize:10, fontWeight:navWeight('messages'), color:navColor('messages'), fontFamily:"'Montserrat',-apple-system,sans-serif" }}>Messages</span>
      </button>
      {/* Profile */}
      <button onClick={()=>setScreen('profile')} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, border:'none', background:'none', cursor:'pointer', width:58 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4 0a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke={navColor('profile')} strokeWidth="1.7" strokeLinejoin="round"/>
        </svg>
        <span style={{ fontSize:10, fontWeight:navWeight('profile'), color:navColor('profile'), fontFamily:"'Montserrat',-apple-system,sans-serif" }}>Profile</span>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: HOME FEED
// ─────────────────────────────────────────────────────────────
function HomeScreen({ liked, toggleLike, saved, toggleSave, shared, recordShare, filters, setFilters, activeCat, setActiveCat, query, setQuery, navigate }) {
  const CATS = [
    {id:'all',label:'All'},{id:'trending',label:'Trending This Week'},{id:'new',label:'New'},{id:'popular',label:'Popular'},
    {id:'career',label:'Career'},{id:'sports',label:'Sports'},{id:'academic',label:'Academic'},{id:'social',label:'Social'},
  ];

  const homeSwipeRef = useRef(null);
  const handleHomeSwipeStart = (e) => { homeSwipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const handleHomeSwipeEnd = (e) => {
    if (!homeSwipeRef.current) return;
    const dx = e.changedTouches[0].clientX - homeSwipeRef.current.x;
    const dy = e.changedTouches[0].clientY - homeSwipeRef.current.y;
    homeSwipeRef.current = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    const ids = CATS.map(c => c.id);
    const i = ids.indexOf(activeCat);
    const next = dx < 0 ? Math.min(i + 1, ids.length - 1) : Math.max(i - 1, 0);
    setActiveCat(ids[next]);
  };
  const { events: liveEvents, loading: eventsLoading, refetch: refetchEvents } = useEvents({ category: (activeCat === 'all' || activeCat === 'trending') ? null : activeCat, search: query, filters });
  const eventData = eventsLoading ? [] : liveEvents;
  let list = eventData.slice();
  if (activeCat==='new') list = [...list].reverse();
  else if (activeCat==='popular') list = [...list].sort((a,b)=>b.attendees-a.attendees);

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative', background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      {/* Header */}
      <div style={{ flexShrink:0, background:C.card, padding:'52px 16px 12px', boxShadow:'0 1px 0 rgba(16,24,40,0.06)', position:'relative', zIndex:4 }}>
        <SearchBar
          placeholder={query || 'What can we help you find?'}
          hint={query ? undefined : 'Try "Social events this weekend"'}
          value={query} onChange={e=>setQuery(e.target.value)}
          onFilter={()=>navigate('filters',{from:'home', filters, setFilters})}
        />
      </div>

      {/* Category tabs */}
      <div style={{ flexShrink:0, background:C.card, padding:'8px 0 12px', zIndex:3, boxShadow:'0 1px 0 rgba(16,24,40,0.04)' }}>
        <Tabs tabs={CATS} active={activeCat} onSelect={setActiveCat} />
      </div>

      {/* Feed */}
      <PullToRefresh onRefresh={refetchEvents} style={{ flex:1, padding:'14px 16px 104px' }}
        onTouchStart={handleHomeSwipeStart} onTouchEnd={handleHomeSwipeEnd}>

        {list.length===0 && !query?.trim() && !eventsLoading && (
          <div style={{ textAlign:'center', padding:'48px 24px', color:C.subtle, fontSize:14 }}>No upcoming events right now.</div>
        )}
        {eventsLoading && list.length===0 && <SkeletonCards />}
        {list.length===0 && query?.trim() && !eventsLoading && (
          <div style={{ textAlign:'center', padding:'48px 24px', color:C.subtle, fontSize:14 }}>No results found for "{query}"</div>
        )}
        {list.map(ev => {
          const th = THEME[ev.primary] || THEME[ev.category] || THEME.social;
          const isLiked = !!liked[ev.id];
          const isSaved = !!saved[ev.id];
          const isSharedEv = !!shared[ev.id];
          return (
            <div key={ev.id} style={{ background:C.card, borderRadius:24, boxShadow:'0 8px 24px rgba(16,24,40,0.07),0 1px 2px rgba(16,24,40,0.04)', marginBottom:16, overflow:'hidden' }}>
              {/* Banner */}
              {(() => {
                const CARD_IMGS = {
                  social:    'https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=800&q=75',
                  sports:    'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&q=75',
                  academic:  'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=800&q=75',
                  arts:      'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&q=75',
                  wellness:  'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&q=75',
                  career:    'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=800&q=75',
                  festival:  'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=75',
                };
                const cardImg = ev.image_url || ev.imageUrl || ev.cover_url || CARD_IMGS[ev.primary] || CARD_IMGS[ev.category] || CARD_IMGS.social;
                const { isFree, amount: priceAmount } = parseEventPrice(ev.price);
                const eventAge = ev.created_at ? Date.now() - new Date(ev.created_at).getTime() : NaN;
                const isNew = Number.isFinite(eventAge) && eventAge >= 0 && eventAge < 2 * 24 * 60 * 60 * 1000;
                return (
                  <div onClick={()=>navigate('event-details',{eventId:ev.id})} style={{ position:'relative', height:172, overflow:'hidden', cursor:'pointer' }}>
                    <img src={cardImg} alt={ev.title}
                      style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', objectPosition:'center' }}/>
                    <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg,rgba(0,0,0,0.22) 0%,transparent 35%,transparent 55%,rgba(0,0,0,0.48) 100%)' }} />
                    {/* Top row: category chip + new badge + trending */}
                    <div style={{ position:'absolute', top:12, left:12, right:12, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ display:'inline-flex', alignItems:'center', height:26, padding:'0 11px', borderRadius:999, background:'rgba(255,255,255,0.92)', fontSize:11, fontWeight:700, letterSpacing:0.3, color:C.body, backdropFilter:'blur(6px)' }}>{th.label}</span>
                        {isNew && <span style={{ display:'inline-flex', alignItems:'center', height:26, padding:'0 11px', borderRadius:999, background:C.grad, fontSize:11, fontWeight:800, letterSpacing:0.3, color:'#fff' }}>New</span>}
                      </div>
                      <div style={{ width:36, height:36, borderRadius:'50%', background:'rgba(255,255,255,0.92)', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(6px)', boxShadow:'0 2px 6px rgba(0,0,0,0.12)' }}>
                        <svg width="17" height="17" viewBox="0 0 24 24"><path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l1-8Z" fill={ev.trending?'#FFB020':'rgba(255,255,255,0)'} stroke={ev.trending?'#F59E0B':'#7B8499'} strokeWidth="1.6" strokeLinejoin="round"/></svg>
                      </div>
                    </div>
                    {/* Bottom row: free entry (left) + recurring badge (right) */}
                    <div style={{ position:'absolute', bottom:12, left:12, right:12, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                      {isFree
                        ? <span style={{ display:'inline-flex', alignItems:'center', height:24, padding:'0 10px', borderRadius:8, background:'rgba(2,162,240,0.88)', fontSize:11, fontWeight:700, color:'#fff', backdropFilter:'blur(6px)' }}>Free entry</span>
                        : ev.price
                          ? <span style={{ display:'inline-flex', alignItems:'center', gap:5, height:26, padding:'0 11px', borderRadius:8, background:'rgba(16,185,129,0.88)', fontSize:13, fontWeight:700, color:'#fff', backdropFilter:'blur(6px)' }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="1.8"/><path d="M12 7v1.2M12 15.8V17M15 9.8a2.6 2.6 0 0 0-2.7-2 2.3 2.3 0 0 0-2.3 2c0 3 5 1.5 5 4.4a2.3 2.3 0 0 1-2.3 2 2.6 2.6 0 0 1-2.7-2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/></svg>
                              Paid · ${priceAmount}
                            </span>
                          : <span/>}
                      {ev.badge && <span style={{ display:'inline-flex', alignItems:'center', height:24, padding:'0 10px', borderRadius:8, background:'rgba(14,23,38,0.55)', fontSize:11, fontWeight:700, color:'#fff', backdropFilter:'blur(6px)' }}>{ev.badge}</span>}
                    </div>
                  </div>
                );
              })()}

              {/* Content */}
              <div style={{ padding:'14px 16px' }}>
                <div onClick={()=>navigate('event-details',{eventId:ev.id})} style={{ fontSize:19, fontWeight:800, letterSpacing:-0.4, color:C.ink, lineHeight:1.2, cursor:'pointer' }}>{ev.title}</div>
                <div style={{ display:'flex', alignItems:'center', gap:14, marginTop:9, flexWrap:'wrap' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" stroke="#7B8499" strokeWidth="1.9"/><circle cx="12" cy="10" r="2.4" stroke="#7B8499" strokeWidth="1.9"/></svg>
                    <span style={{ fontSize:13, fontWeight:500, color:C.muted }}>{ev.location}</span>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:6 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="#7B8499" strokeWidth="1.9"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="#7B8499" strokeWidth="1.9" strokeLinecap="round"/></svg>
                  <span style={{ fontSize:13, fontWeight:600, color:'#0094E0' }}>
                    {fmtDate(ev.fullDate || ev.full_date || ev.date, '-')}{(ev.start_time || ev.startTime) ? (' · ' + fmt12(ev.start_time || ev.startTime)) : (ev.time_range ? ' · ' + fmt12(ev.time_range.split(' – ')[0]) : '')}
                  </span>
                </div>
                <div style={{ fontSize:13.5, lineHeight:1.5, color:'#6B7385', marginTop:10, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{ev.desc || ev.description}</div>

                {/* Organizer row -- tapping through to the group page only
                    when the event actually belongs to one; a solo organizer
                    (no group_id) has no profile page to show. The old
                    "Follow" button here was wired to toggleRsvp (event
                    RSVPs), so tapping it silently created a fake RSVP row
                    and fired the organizer's "someone's attending your
                    event" notification -- removed rather than reused, since
                    GroupProfileScreen already has its own real join/request
                    state for this group. */}
                <div onClick={() => ev.group_id && navigate('group-profile', { groupId: ev.group_id })}
                  style={{ display:'flex', alignItems:'center', gap:9, minWidth:0, marginTop:13,
                           cursor: ev.group_id ? 'pointer' : 'default' }}>
                  <div style={{ width:30, height:30, borderRadius:'50%', flexShrink:0, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:'#fff', background: ev.org_avatar ? 'transparent' : (ev.org_color || th.org) }}>
                    {ev.org_avatar ? <img src={ev.org_avatar} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" /> : ev.orgInitial}
                  </div>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:C.body, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{ev.org}</div>
                    <div style={{ fontSize:11, color:C.subtle }}>Organizer</div>
                  </div>
                </div>

                {/* Divider */}
                <div style={{ height:1, background:C.divider, margin:'13px 0 11px' }} />

                {/* Metrics */}
                <div style={{ display:'flex', alignItems:'center', gap:18 }}>
                  <button onClick={()=>toggleLike(ev.id)} style={{ display:'flex', alignItems:'center', gap:6, border:'none', background:'none', padding:0, cursor:'pointer' }}>
                    <svg width="19" height="19" viewBox="0 0 24 24"><path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7C20.5 15 12 20.5 12 20.5Z" fill={isLiked?'#FF3B6B':'rgba(0,0,0,0)'} stroke={isLiked?'#FF3B6B':'#9AA3B2'} strokeWidth="1.8" strokeLinejoin="round"/></svg>
                    <span style={{ fontSize:13, fontWeight:700, color:isLiked?'#FF3B6B':C.subtle }}>{fmt(ev.likes+(isLiked?1:0))}</span>
                  </button>
                  <button onClick={()=>toggleSave(ev.id)} style={{ display:'flex', alignItems:'center', gap:6, border:'none', background:'none', padding:0, cursor:'pointer' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24"><path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z" fill={isSaved?'#0098F0':'rgba(0,0,0,0)'} stroke={isSaved?'#0098F0':'#9AA3B2'} strokeWidth="1.7" strokeLinejoin="round"/></svg>
                    <span style={{ fontSize:13, fontWeight:700, color:isSaved?C.primary:C.subtle }}>{fmt(ev.saves+(isSaved?1:0))}</span>
                  </button>
                  <button onClick={async (e) => {
                    e.stopPropagation();
                    const shareData = {
                      title: ev.title,
                      text: `${ev.title}${ev.date ? ' · ' + ev.date : ''}`,
                      url: window.location.href,
                    };
                    let didShare = false;
                    if (navigator.share) {
                      try { await navigator.share(shareData); didShare = true; } catch {}
                    } else {
                      try {
                        await navigator.clipboard.writeText(`${shareData.title}\n${shareData.text}\n${shareData.url}`);
                        didShare = true;
                      } catch {}
                    }
                    if (didShare) recordShare(ev.id);
                  }} style={{ display:'flex', alignItems:'center', gap:6, border:'none', background:'none', padding:0, cursor:'pointer' }}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                      <circle cx="18" cy="5" r="3" fill={isSharedEv ? '#FF8A3D' : 'none'} stroke={isSharedEv ? '#FF8A3D' : '#7B8499'} strokeWidth="1.8"/>
                      <circle cx="6" cy="12" r="3" fill={isSharedEv ? '#FF8A3D' : 'none'} stroke={isSharedEv ? '#FF8A3D' : '#7B8499'} strokeWidth="1.8"/>
                      <circle cx="18" cy="19" r="3" fill={isSharedEv ? '#FF8A3D' : 'none'} stroke={isSharedEv ? '#FF8A3D' : '#7B8499'} strokeWidth="1.8"/>
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" stroke={isSharedEv ? '#FF8A3D' : '#7B8499'} strokeWidth="1.8"/>
                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" stroke={isSharedEv ? '#FF8A3D' : '#7B8499'} strokeWidth="1.8"/>
                    </svg>
                    <span style={{ fontSize:13, fontWeight:700, color: isSharedEv ? '#FF8A3D' : '#7B8499' }}>{fmt((ev.shares || 0) + (isSharedEv ? 1 : 0))}</span>
                  </button>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginLeft:'auto' }}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8.5" r="3" stroke="#7B8499" strokeWidth="1.8"/><path d="M3.5 19c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" stroke="#7B8499" strokeWidth="1.8" strokeLinecap="round"/><path d="M16 6a3 3 0 0 1 0 5.5M17 14.6c2.6.3 4.5 1.8 4.5 4.4" stroke="#7B8499" strokeWidth="1.8" strokeLinecap="round"/></svg>
                    <span style={{ fontSize:13, fontWeight:700, color:C.body }}>{(ev.attendee_count || ev.attendees) ? fmt(ev.attendee_count || ev.attendees) : '-'} <span style={{ color:C.subtle, fontWeight:500 }}>going</span></span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </PullToRefresh>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: SPACES (Campus Groups)
// ─────────────────────────────────────────────────────────────
function SpacesScreen({ spaceTab, setSpaceTab, spaceJoined, setSpaceJoined, spaceNotify, setSpaceNotify, progress, navigate, showToast, currentUser }) {
  const TABS = [{id:'all',label:'All'},{id:'today',label:'Today'},{id:'tomorrow',label:'Tomorrow'},{id:'academic',label:'Academic'},{id:'social',label:'Social'},{id:'sports',label:'Sports'}];
  const [spaceQuery, setSpaceQuery] = useState('');
  const spacesSwipeRef = useRef(null);
  const handleSpacesSwipeStart = (e) => { spacesSwipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const handleSpacesSwipeEnd = (e) => {
    if (!spacesSwipeRef.current) return;
    const dx = e.changedTouches[0].clientX - spacesSwipeRef.current.x;
    const dy = e.changedTouches[0].clientY - spacesSwipeRef.current.y;
    spacesSwipeRef.current = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    const ids = TABS.map(t => t.id);
    const i = ids.indexOf(spaceTab);
    const next = dx < 0 ? Math.min(i + 1, ids.length - 1) : Math.max(i - 1, 0);
    setSpaceTab(ids[next]);
  };

  const { spaces: liveSpaces, loading: spacesLoading, refetch: refetchSpaces } = useSpaces();
  const spaceData = spacesLoading ? [] : liveSpaces;
  let list = spaceData.slice();
  if(spaceTab==='today'||spaceTab==='tomorrow') list=list.filter(s=>s.day===spaceTab);
  else if(spaceTab!=='all') list=list.filter(s=>(s.cat||s.category)===spaceTab);
  if(spaceQuery.trim()) {
    const q = spaceQuery.toLowerCase();
    list = list.filter(s => (s.title||'').toLowerCase().includes(q) || (s.location||'').toLowerCase().includes(q) || (s.desc||s.description||'').toLowerCase().includes(q));
  }

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative', background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink:0, background:C.card, padding:'52px 16px 12px', boxShadow:'0 1px 0 rgba(16,24,40,0.06)', zIndex:4 }}>
        <SearchBar placeholder="What can we help you find?" hint='Try "Study groups near me"' value={spaceQuery} onChange={e=>setSpaceQuery(e.target.value)} onFilter={()=>navigate('filters',{from:'spaces'})} />
      </div>

      {/* Tabs */}
      <div style={{ flexShrink:0, background:C.card, padding:'8px 0 12px', boxShadow:'0 1px 0 rgba(16,24,40,0.04)' }}>
        <Tabs tabs={TABS} active={spaceTab} onSelect={setSpaceTab} />
      </div>

      {/* Spaces list */}
      <PullToRefresh onRefresh={refetchSpaces} style={{ flex:1, padding:'14px 16px 104px' }}
        onTouchStart={handleSpacesSwipeStart} onTouchEnd={handleSpacesSwipeEnd}>
        {list.length===0 && !spacesLoading && <div style={{ textAlign:'center', padding:'48px 24px', color:C.subtle, fontSize:14 }}>No spaces in this category right now.</div>}
        {spacesLoading && list.length===0 && <SkeletonRows />}
        {list.map(sp => {
          const isJoined = !!spaceJoined[sp.id];
          const count = sp.participants + (isJoined?1:0);
          const isFull = count >= (sp.max_spots || sp.max || 10);
          const notifyOn = !!spaceNotify[sp.id];
          const prog = calcSpaceProgress(sp.time, sp.day, sp.duration) ?? 0;
          const isLive = prog > 0;
          const done = prog >= 100;

          return (
            <div key={sp.id} style={{ background:C.card, borderRadius:22, boxShadow:'0 8px 24px rgba(16,24,40,0.07),0 1px 2px rgba(16,24,40,0.04)', marginBottom:16, padding:'16px 16px 14px' }}>
              {/* Title + Avatar */}
              <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div onClick={()=>navigate('space-details',{spaceId:sp.id})} style={{ fontSize:18, fontWeight:800, letterSpacing:-0.4, color:C.ink, lineHeight:1.2, cursor:'pointer' }}>{sp.title}</div>
                  <div style={{ fontSize:13, color:'#7B8499', marginTop:3, lineHeight:1.4 }}>{sp.desc || sp.description || ""}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:7 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" stroke={C.subtle} strokeWidth="1.9"/><circle cx="12" cy="10" r="2.4" stroke={C.subtle} strokeWidth="1.9"/></svg>
                    <span style={{ fontSize:12.5, fontWeight:600, color:'#8A93A6' }}>{sp.location}</span>
                  </div>
                </div>
                <div style={{ width:50, height:50, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:17, fontWeight:800, background:sp.avatarColor || sp.avatar_color || "linear-gradient(135deg,#19BFFF,#0098F0)", boxShadow:'0 4px 10px rgba(16,24,40,0.12)', overflow:'hidden' }}>
                  {sp.image_url ? <img src={sp.image_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/> : (sp.avatarInitial || sp.avatar_initial || "S")}
                </div>
              </div>

              {/* Stats row */}
              <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginTop:15 }}>
                {[{label:'Participants',val:`${count}/${sp.max_spots || sp.max || 10}`,color:C.body},{label:'Time',val:sp.time,color:C.primary},{label:'Duration',val:(/^\d+$/.test(String(sp.duration||''))?`${sp.duration} min`:sp.duration)||'—',color:C.body}].map(s=>(
                  <div key={s.label} style={{ flex:1 }}>
                    <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:0.4, textTransform:'uppercase', color:C.subtle }}>{s.label}</div>
                    <div style={{ fontSize:16, fontWeight:800, color:s.color, marginTop:3 }}>{s.val}</div>
                  </div>
                ))}
              </div>

              {/* Live progress */}
              {isLive && (
                <div style={{ marginTop:14 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:7 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ position:'relative', width:8, height:8, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                        <span style={{ position:'absolute', width:8, height:8, borderRadius:'50%', background:'#10B981', opacity:0.5, animation:'riplyPulse 1.6s ease-out infinite' }} />
                        <span style={{ width:8, height:8, borderRadius:'50%', background:'#10B981' }} />
                      </span>
                      <span style={{ fontSize:11.5, fontWeight:800, color:'#10B981', letterSpacing:0.2 }}>{done?'ENDED':'IN PROGRESS'}</span>
                    </div>
                    <span style={{ fontSize:11.5, fontWeight:700, color:C.subtle }}>{done ? 'Completed' : `${prog}%`}</span>
                  </div>
                  <div style={{ position:'relative', height:8, borderRadius:999, background:'#EAEDF2' }}>
                    <div style={{ position:'absolute', left:0, top:0, bottom:0, borderRadius:999, background:'linear-gradient(90deg,#34D399,#10B981)', width:`${prog}%`, transition:'width .6s linear' }} />
                    <div style={{ position:'absolute', top:'50%', transform:'translate(-50%,-50%)', left:`${prog}%`, width:15, height:15, borderRadius:'50%', background:'#fff', border:'3px solid #10B981', boxShadow:'0 2px 5px rgba(16,185,129,0.4)', transition:'left .6s linear' }} />
                  </div>
                </div>
              )}

              {/* Action */}
              {done ? (
                <button disabled style={{ width:'100%', marginTop:15, height:50, border:'none', borderRadius:15, background:'#D1D5DB', color:'#6B7280', fontSize:15, fontWeight:800, cursor:'not-allowed', fontFamily:"'Montserrat',-apple-system,sans-serif", display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                  Space Ended
                </button>
              ) : isFull ? (
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:15 }}>
                    <button style={{ flex:1, height:50, border:'none', borderRadius:15, background:C.subtle, color:'#fff', fontSize:15, fontWeight:800, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                      Space Full
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="1.9"/><path d="m6 6 12 12" stroke="#fff" strokeWidth="1.9" strokeLinecap="round"/></svg>
                    </button>
                    <button onClick={()=>setSpaceNotify(n=>({...n,[sp.id]:!n[sp.id]}))} style={{ width:50, height:50, borderRadius:15, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', border:notifyOn?'none':'1.6px solid #E3E7EE', background:notifyOn?'#E9F6FF':'#fff' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5Z" stroke={notifyOn?C.primary:'#7B8499'} fill={notifyOn?'#E9F6FF':'none'} strokeWidth="1.9" strokeLinejoin="round"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0" stroke={notifyOn?C.primary:'#7B8499'} strokeWidth="1.9" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                  {notifyOn && <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:9, justifyContent:'center' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="#10B981" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <span style={{ fontSize:12, fontWeight:700, color:'#10B981' }}>We'll notify you the moment a spot opens up</span>
                  </div>}
                </div>
              ) : (
                <button onClick={async()=>{
                  const uid = currentUser?.userId;
                  const newJoined = !isJoined;
                  setSpaceJoined(j=>({...j,[sp.id]:newJoined}));
                  if (uid) {
                    if (newJoined) {
                      await supabase.from('space_participants').upsert({ space_id: sp.id, user_id: uid }, { onConflict: 'space_id,user_id' });
                    } else {
                      await supabase.from('space_participants').delete().eq('space_id', sp.id).eq('user_id', uid);
                    }
                  }
                }} style={{ width:'100%', marginTop:15, height:50, border: isJoined?'1.6px solid #10B981':'none', borderRadius:15, background: isJoined?'#E6F8F0':C.grad, color: isJoined?'#0E9F6E':'#fff', fontSize:15, fontWeight:800, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", display:'flex', alignItems:'center', justifyContent:'center', gap:8, boxShadow:isJoined?'none':'0 8px 20px rgba(2,162,240,0.4)' }}>
                  <span>{isJoined ? "You're in · Joined ✓" : 'Join Space'}</span>
                  {!isJoined && <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </button>
              )}

              {/* Host */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:5, marginTop:10 }}>
                {sp.host_avatar
                  ? <img src={sp.host_avatar} style={{ width:16, height:16, borderRadius:'50%', objectFit:'cover' }} alt="" />
                  : <div style={{ width:16, height:16, borderRadius:'50%', background: sp.host_color || C.grad, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:800, color:'#fff' }}>{(sp.host_name || sp.host_text || 'O')[0].toUpperCase()}</div>
                }
                <span style={{ fontSize:11.5, color:C.subtle }}>Created by {sp.host_name || (sp.host_text || '').replace(/^(Created by |Organized by )/i,'') || 'Organizer'}</span>
              </div>
            </div>
          );
        })}
      </PullToRefresh>

      {/* FAB */}
      <button onClick={()=>navigate('create-space')} style={{ position:'absolute', bottom:94, right:18, width:60, height:60, border:'none', borderRadius:'50%', background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 10px 24px rgba(2,162,240,0.45)', zIndex:6 }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/></svg>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: DISCOVER GROUPS
// ─────────────────────────────────────────────────────────────
function DiscoverScreen({ discoverTab, setDiscoverTab, groupJoined, setGroupJoined, navigate, showToast }) {
  const { user } = useUser();
  const TABS = [{id:'all',label:'All'},{id:'popular',label:'Popular'},{id:'culture',label:'Culture'},{id:'religion',label:'Religion'},{id:'social',label:'Social'},{id:'academic',label:'Academic'},{id:'sports',label:'Sports'}];
  const [discoverQuery, setDiscoverQuery] = useState('');
  // groupJoined only tracks "has a group_members row" — it can't by itself
  // distinguish an approved membership from a pending request, so track
  // pending state separately to avoid the button reading "Joined ✓" right
  // after sending a request to a request-only group.
  const [pendingRequests, setPendingRequests] = useState({});
  // Per-group in-flight guard — a rapid double-tap on the same group's
  // button would otherwise fire an upsert and a delete concurrently, racing
  // against each other and potentially leaving the UI and DB disagreeing.
  const joinMutatingRef = useRef({});

  const { groups: liveGroups, loading: groupsLoading, refetch: refetchGroups } = useGroups();
  const groupData = groupsLoading ? [] : liveGroups;
  let list = groupData.slice();
  if(discoverTab==='popular') list=[...list].sort((a,b)=>(b.member_count||0)-(a.member_count||0));
  else if(discoverTab!=='all') list=list.filter(g=>((g.cat || g.category || [])||g.category||[]).includes(discoverTab));
  if(discoverQuery.trim()) {
    const q = discoverQuery.toLowerCase();
    list = list.filter(g => (g.name||g.title||'').toLowerCase().includes(q) || (g.desc||g.description||'').toLowerCase().includes(q));
  }

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative', background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink:0, background:C.card, padding:'52px 16px 12px', boxShadow:'0 1px 0 rgba(16,24,40,0.06)', zIndex:4 }}>
        <SearchBar placeholder="What can we help you find?" hint='Try "Clubs to join this semester"' value={discoverQuery} onChange={e=>setDiscoverQuery(e.target.value)} onFilter={()=>navigate('filters',{from:'discover'})} />
      </div>

      {/* Tabs */}
      <div style={{ flexShrink:0, background:C.card, padding:'8px 0 12px', boxShadow:'0 1px 0 rgba(16,24,40,0.04)' }}>
        <Tabs tabs={TABS} active={discoverTab} onSelect={setDiscoverTab} />
      </div>

      {/* Groups */}
      <PullToRefresh onRefresh={refetchGroups} style={{ flex:1, padding:'14px 16px 104px' }}>
        {list.length===0 && !groupsLoading && <div style={{ textAlign:'center', padding:'48px 24px', color:C.subtle, fontSize:14 }}>No groups in this category yet.</div>}
        {groupsLoading && list.length===0 && <SkeletonRows />}
        {list.map(g => {
          const localJoined = !!groupJoined[g.id];
          const isPending = !!pendingRequests[g.id];
          const isJoined = ((g.state || "join") === 'joined' || localJoined) && !isPending;
          const isReq = (g.state || "join") === 'request' && !localJoined && !isPending;
          const hasEntry = isJoined || isPending;

          let joinLabel;
          let joinStyle = {};
          if(isPending) { joinLabel='Requested · Pending'; joinStyle={ border:`1.6px solid ${C.border}`, background:'#fff', color:'#7B8499' }; }
          else if(isReq) { joinLabel='Request'; joinStyle={ border:'1.6px solid #E3E7EE', background:'#fff', color:'#5B6473' }; }
          else if(isJoined) { joinLabel='Joined ✓'; joinStyle={ border:'1.6px solid #10B981', background:'#E6F8F0', color:'#0E9F6E' }; }
          else { joinLabel='Join'; joinStyle={ border:'none', background:C.primary, color:'#fff', boxShadow:'0 4px 10px rgba(2,162,240,0.3)' }; }

          return (
            <div key={g.id} style={{ background:C.card, borderRadius:20, boxShadow:'0 6px 20px rgba(16,24,40,0.06)', marginBottom:14, padding:15 }}>
              <div onClick={()=>navigate('group-profile',{groupId:g.id})} style={{ display:'flex', gap:13, cursor:'pointer' }}>
                <div style={{ width:58, height:58, borderRadius:'50%', flexShrink:0, background:g.logoColor || g.logo_color || "linear-gradient(135deg,#19BFFF,#0098F0)", position:'relative', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 10px rgba(16,24,40,0.1)' }}>
                  {g.avatar_url
                    ? <img src={g.avatar_url} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>
                    : <><span style={{ fontSize:20, fontWeight:800, color:'#fff' }}>{g.initial || (g.name || "G")[0].toUpperCase()}</span>
                        <div style={{ position:'absolute', inset:0, background:'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 13px)' }} /></>}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:16, fontWeight:800, letterSpacing:-0.3, color:C.ink, lineHeight:1.2 }}>{g.name}</span>
                    {(isReq || isPending) && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}><rect x="5" y="11" width="14" height="9" rx="2.2" stroke={C.subtle} strokeWidth="1.9"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke={C.subtle} strokeWidth="1.9"/></svg>}
                  </div>
                  <div style={{ fontSize:13, lineHeight:1.45, color:'#7B8499', marginTop:4, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{g.desc || g.description || ""}</div>
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:13 }}>
                <div style={{ display:'flex', alignItems:'center' }}>
                 {(g.member_previews || []).map((m,i)=>(
                    <div key={i} style={{ width:30, height:30, borderRadius:'50%', marginLeft: i>0?-8:0, border:'2.5px solid #fff', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:11, fontWeight:800, overflow:'hidden', position:'relative', background: m.avatar_url ? 'transparent' : (m.avatar_color || '#7C5CFF') }}>
                      {m.avatar_url
                        ? <img src={m.avatar_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                        : m.initial}
                    </div>
                  ))}
                  <span style={{ fontSize:13, fontWeight:700, color:C.muted, marginLeft:11 }}>{g.member_count || '—'}</span>
                  <span style={{ fontSize:12, color:C.subtle, marginLeft:4 }}>members</span>
                </div>
                <button onClick={async ()=>{
                  if (!user?.id) { showToast('Sign in to join groups'); return; }
                  const isUuid = typeof g.id === 'string' && g.id.includes('-');
                  if (!isUuid) return;
                  if (joinMutatingRef.current[g.id]) return;
                  joinMutatingRef.current[g.id] = true;
                  const wasReq = isReq;
                  const nowJoined = !hasEntry;
                  setGroupJoined(j=>({...j,[g.id]:nowJoined}));
                  setPendingRequests(p=>({...p,[g.id]: nowJoined && wasReq}));
                  // Request-only groups need approval — write a pending row,
                  // not an instant membership, so this button matches its
                  // own "Request" label instead of silently joining outright.
                  const { error } = nowJoined
                    ? await supabase.from('group_members').upsert({ group_id: g.id, user_id: user.id, role: wasReq ? 'pending' : 'member' })
                    : await supabase.from('group_members').delete().eq('group_id', g.id).eq('user_id', user.id);
                  joinMutatingRef.current[g.id] = false;
                  if (error) {
                    setGroupJoined(j=>({...j,[g.id]:hasEntry}));
                    setPendingRequests(p=>({...p,[g.id]: isPending}));
                    showToast((nowJoined ? (wasReq ? 'Failed to send request: ' : 'Failed to join: ') : 'Failed to leave: ') + error.message);
                  }
                }} style={{ flexShrink:0, height:38, padding:'0 20px', borderRadius:999, fontSize:14, fontWeight:800, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", ...joinStyle }}>
                  {joinLabel}
                </button>
              </div>
            </div>
          );
        })}
      </PullToRefresh>

      {/* FAB */}
      <button onClick={()=>navigate('create-group')} style={{ position:'absolute', bottom:94, right:18, width:60, height:60, border:'none', borderRadius:'50%', background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 10px 24px rgba(2,162,240,0.45)', zIndex:6 }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/></svg>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: MESSAGES
// ─────────────────────────────────────────────────────────────
function MessagesScreen({ msgTab, setMsgTab, navigate, showToast, notifs, chatsData, groupActivityData }) {
  const isNotif = msgTab==='notifications';
  const { chats, loading: chatsLoading, deleteChat, refetch: refetchChats } = chatsData;
  const { notifications, loading: notifsLoading, unreadCount, markRead, markAllRead, deleteNotification, refetch: refetchNotifs } = notifs;
  const { groupActivity, loading: groupActivityLoading, markGroupRead, refetch: refetchGroupActivity } = groupActivityData;
  const activeTabStyle = { border:'none', background:'none', cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", fontSize:16, fontWeight:800, color:C.primary, padding:'0 0 4px' };
  const idleTabStyle = { ...activeTabStyle, fontWeight:700, color:C.subtle };

  const [searchOpen, setSearchOpen] = useState(false);
  const [chatQuery,  setChatQuery]  = useState('');
  const q = chatQuery.trim().toLowerCase();
  const filteredChats = q
    ? chats.filter(c => c.name?.toLowerCase().includes(q) || c.preview?.toLowerCase().includes(q))
    : chats;

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative', background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink:0, background:C.card, padding:'52px 16px 0', boxShadow:'0 1px 0 rgba(16,24,40,0.04)', zIndex:4 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <span style={{ fontSize:24, fontWeight:800, letterSpacing:-0.6, color:C.ink }}>My Messages</span>
          <div style={{ display:'flex', gap:9 }}>
            <button onClick={()=>{ setSearchOpen(v=>!v); setChatQuery(''); }} aria-label="Search chats" aria-expanded={searchOpen && !isNotif} aria-pressed={searchOpen && !isNotif} style={{ width:40, height:40, border:'none', borderRadius:'50%', background: searchOpen ? C.grad : C.chip, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={searchOpen ? '#fff' : '#39414F'} strokeWidth="2"/><path d="m20 20-3.2-3.2" stroke={searchOpen ? '#fff' : '#39414F'} strokeWidth="2" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>
        {/* Tabs */}
        <div style={{ display:'flex', gap:26, marginBottom:11 }}>
          <button onClick={()=>setMsgTab('notifications')} style={isNotif?activeTabStyle:idleTabStyle}>
            Notifications
            {unreadCount > 0 && <span style={{ marginLeft:6, display:'inline-flex', alignItems:'center', justifyContent:'center', minWidth:18, height:18, padding:'0 5px', borderRadius:999, background:'#FF3B6B', color:'#fff', fontSize:10, fontWeight:800, verticalAlign:'middle' }}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </button>
          <button onClick={()=>setMsgTab('chats')} style={isNotif?idleTabStyle:activeTabStyle}>Chats</button>
        </div>
        {searchOpen && !isNotif && (
          <div style={{ marginTop:12 }}>
            <SearchBar placeholder="Search chats…" value={chatQuery} onChange={e=>setChatQuery(e.target.value)} />
          </div>
        )}
      </div>

      {/* Body */}
      <PullToRefresh onRefresh={isNotif ? (() => Promise.all([refetchNotifs(), refetchGroupActivity()])) : refetchChats} style={{ flex:1, padding:'14px 16px 104px' }}>
        {isNotif ? (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {/* Mark all read */}
            {unreadCount > 0 && (
              <button onClick={markAllRead} style={{ alignSelf:'flex-end', border:'none', background:'none', fontSize:13, fontWeight:700, color:C.primary, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", padding:'2px 0' }}>
                Mark all as read
              </button>
            )}
            {/* Group activity -- one row per group showing its latest post
                and how many posts you haven't seen yet. */}
            {!groupActivityLoading && groupActivity.map(a => (
              <div key={a.id} onClick={() => { markGroupRead(a.groupId); navigate('group-profile', { groupId: a.groupId }); }}
                style={{ background: a.missedCount > 0 ? '#F0F8FF' : C.card, borderRadius:18,
                         boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:14,
                         cursor:'pointer', borderLeft: a.missedCount > 0 ? `3px solid ${C.primary}` : 'none' }}>
                <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                  <div style={{ width:46, height:46, borderRadius:'50%', flexShrink:0, background:a.color,
                                display:'flex', alignItems:'center', justifyContent:'center',
                                color:'#fff', fontSize:18, position:'relative', overflow:'hidden' }}>
                    {a.avatarUrl
                      ? <img src={a.avatarUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', position:'absolute', inset:0 }} />
                      : <span>{a.initial}</span>
                    }
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                      <span style={{ fontSize:15, fontWeight:800, color:C.ink }}>{a.name}</span>
                      <span style={{ fontSize:11, color:C.subtle, fontWeight:600, flexShrink:0 }}>{a.time}</span>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:5 }}>
                      {a.missedCount > 0 && (
                        <span style={{ display:'flex', alignItems:'center', justifyContent:'center', minWidth:22, height:22, padding:'0 6px', borderRadius:999, background:C.primary, color:'#fff', fontSize:11, fontWeight:800, flexShrink:0 }}>
                          {a.missedCount > 99 ? '99+' : a.missedCount}
                        </span>
                      )}
                      <span style={{ fontSize:13, lineHeight:1.4, color: a.missedCount > 0 ? C.primary : '#7B8499', fontWeight: a.missedCount > 0 ? 700 : 500, fontStyle: a.missedCount > 0 ? 'italic' : 'normal', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {a.preview}
                      </span>
                    </div>
                  </div>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0, marginTop:14 }}><path d="m9 6 6 6-6 6" stroke={C.subtle} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              </div>
            ))}
            {notifsLoading ? (
              <SkeletonRows />
            ) : notifications.length === 0 && groupActivity.length === 0 ? (
              <div style={{ textAlign:'center', paddingTop:48 }}>
                <div style={{ marginBottom:12, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
                    <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5Z"
                          stroke={C.primary} strokeWidth="1.7" strokeLinejoin="round"/>
                    <path d="M10 19.5a2.2 2.2 0 0 0 4 0"
                          stroke={C.primary} strokeWidth="1.7" strokeLinecap="round"/>
                  </svg>
                </div>
                <div style={{ fontSize:16, fontWeight:700, color:C.ink }}>All caught up</div>
                <div style={{ fontSize:14, color:C.subtle, marginTop:6 }}>No notifications yet</div>
              </div>
            ) : notifications.map(n => (
              <SwipeToDeleteRow key={n.id} onDelete={() => deleteNotification(n.id)} deleteLabel={`Delete notification: ${n.title}`}>
                <div onClick={() => markRead(n.id)}
                  style={{ background: n.read ? C.card : '#F0F8FF', borderRadius:18,
                           boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:14,
                           cursor:'pointer', position:'relative',
                           borderLeft: n.read ? 'none' : `3px solid ${C.primary}` }}>
                  <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                    <div style={{ width:46, height:46, borderRadius:'50%', flexShrink:0, background:n.color,
                                  display:'flex', alignItems:'center', justifyContent:'center',
                                  color:'#fff', fontSize:18, position:'relative', overflow:'hidden' }}>
                      <span>{n.initial}</span>
                      <div style={{ position:'absolute', inset:0, background:'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 12px)' }} />
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:15, fontWeight: n.read ? 700 : 800, color:C.ink }}>{n.title}</div>
                      <div style={{ fontSize:13, lineHeight:1.45, color:'#7B8499', marginTop:3 }}>{n.body}</div>
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6, flexShrink:0 }}>
                      <span style={{ fontSize:11, color:C.subtle, fontWeight:600 }}>{n.time}</span>
                      <button onClick={e => { e.stopPropagation(); deleteNotification(n.id); }}
                        style={{ border:'none', background:'none', cursor:'pointer', padding:2, color:C.subtle, fontSize:16, lineHeight:1 }}>×</button>
                    </div>
                  </div>
                </div>
              </SwipeToDeleteRow>
            ))}
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:11 }}>
            {chatsLoading ? (
              <SkeletonRows />
            ) : chats.length === 0 ? (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', paddingTop:60 }}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                        stroke={C.primary} strokeWidth="1.7" strokeLinejoin="round"/>
                </svg>
                <div style={{ fontSize:16, fontWeight:700, color:C.ink, marginTop:12 }}>No conversations yet</div>
                <div style={{ fontSize:14, color:C.subtle, marginTop:6 }}>Start a chat to connect with someone</div>
              </div>
            ) : filteredChats.length === 0 ? (
              <div style={{ textAlign:'center', color:C.subtle, fontSize:15, paddingTop:60 }}>
                No chats match "{chatQuery.trim()}"
              </div>
            ) : filteredChats.map(c => (
              <SwipeToDeleteRow key={c.id} deleteLabel={`Delete chat with ${c.name}`} onDelete={async () => {
                const { error } = await deleteChat(c.id);
                if (error) showToast("Couldn't delete chat. Try again.");
              }}>
                <div onClick={()=>navigate('chat',{
                  chatId: c.id, chatName: c.name, chatInitial: c.initial, chatColor: c.color, chatAvatarUrl: c.avatar_url, isGroup: !!c.group_id,
                })} style={{ display:'flex', gap:12, alignItems:'center', background:C.card, borderRadius:18, boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:'13px 14px', cursor:'pointer' }}>
                  <div style={{ width:50, height:50, borderRadius:'50%', flexShrink:0, background:c.color || C.grad, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:16, fontWeight:800, position:'relative', overflow:'hidden' }}>
                    {c.avatar_url
                      ? <img src={c.avatar_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', position:'absolute', inset:0 }} />
                      : <><span>{c.initial || (c.name?.[0]?.toUpperCase() || '?')}</span>
                          <div style={{ position:'absolute', inset:0, background:'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 12px)' }} /></>
                    }
                    {c.unread && (
                      <span style={{ position:'absolute', top:2, right:2, width:12, height:12, borderRadius:'50%',
                                     background:C.primary, border:'2px solid #fff' }}/>
                    )}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                      <span style={{ fontSize:15, fontWeight:800, color:C.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.name}</span>
                      <span style={{ fontSize:11, color:C.subtle, fontWeight:600, flexShrink:0 }}>{c.time}</span>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginTop:3 }}>
                      <span style={{ fontSize:13, color: c.unread?C.body:'#8A93A6', fontWeight: c.unread?700:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.preview}</span>
                      {c.unread && <span style={{ flexShrink:0, minWidth:20, height:20, padding:'0 6px', borderRadius:999, background:C.primary, color:'#fff', fontSize:11, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center' }}>{c.unreadCount}</span>}
                    </div>
                  </div>
                </div>
              </SwipeToDeleteRow>
            ))}
          </div>
        )}
      </PullToRefresh>
    </div>
  );
}






// ─────────────────────────────────────────────────────────────
// SCREEN: CREATE POST
// ─────────────────────────────────────────────────────────────
function CreatePostScreen({ goBack, groupId, showToast }) {
  const { user } = useUser();
  const currentUser = useCurrentUser();
  // A plain read-only fetch, not useEvents() — that hook also deletes past
  // events as a side effect of loading its list, which shouldn't run just
  // because someone opened the post composer.
  const [linkableEvents, setLinkableEvents] = useState([]);
  useEffect(() => {
    // events.date is stored as a plain YYYY-MM-DD string; comparing it
    // against a full ISO timestamp would exclude today's events (the
    // date-only string sorts before any same-day timestamp).
    const now = new Date();
    const todayStr = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    supabase.from('events').select('id,title,date')
      .gte('date', todayStr)
      .or('status.is.null,status.eq.published')
      .order('date', { ascending: true })
      .limit(50)
      .then(({ data }) => setLinkableEvents(data || []));
  }, []);
  // Real groups the user is an approved member of, not the static mock
  // GROUPS array -- that never matched a real DB groupId, so this always
  // silently fell back to whatever mock group happened to be first
  // ("History Club") regardless of which group the user actually opened
  // the composer from.
  const [myGroups, setMyGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState(groupId || null);
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase.from('group_members').select('group_id, role, groups(id, name, initial, logo_color, avatar_url, permissions)')
      .eq('user_id', user.id).eq('status', 'approved').in('role', ['member', 'admin', 'owner'])
      .then(({ data }) => {
        if (cancelled) return;
        // Keep the member's own role alongside the group so the composer can
        // tell "membersPost:false" apart from "but I'm an admin, so I still can".
        const groups = (data || []).filter(r => r.groups).map(r => ({ ...r.groups, myRole: r.role }));
        setMyGroups(groups);
        setSelectedGroupId(prev => prev || groupId || groups[0]?.id || null);
      });
    return () => { cancelled = true; };
  }, [user?.id, groupId]);
  const selectedGroup = myGroups.find(g => g.id === selectedGroupId) || null;

  const [text,        setText]        = useState('');
  // Multiple photos: each entry is { id, previewUrl (blob, revoked on removal/
  // unmount), url (uploaded Supabase URL, null while still uploading) }.
  const [images,      setImages]      = useState([]);
  useEffect(() => () => {
    images.forEach(img => URL.revokeObjectURL(img.previewUrl));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- unmount-only cleanup, re-running per images change would revoke URLs still in use
  const [fileUrl,     setFileUrl]     = useState(null);
  const [fileName,    setFileName]    = useState(null);
  const [hasPoll,     setHasPoll]     = useState(false);
  const [pollOpts,    setPollOpts]    = useState(['', '']);
  const [linkedEvent, setLinkedEvent] = useState(null);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [pickerOpen,  setPickerOpen]  = useState(false);
  const [posting,     setPosting]     = useState(false);
  const [uploading,   setUploading]   = useState(false);
  const photoInputRef = useRef(null);
  const fileInputRef  = useRef(null);

  const uploadedImageUrls = images.map(img => img.url).filter(Boolean);
  const hasPhoto = images.length > 0;
  const hasFile  = !!fileUrl;
  const photosUploading = images.some(img => !img.url);

  const canPost = hasPoll
    ? text.trim().length > 0 && pollOpts.filter(o => o.trim()).length >= 2
    : !!(text.trim() || hasPhoto || hasFile || linkedEvent);

  // membersPost defaults to true when a group hasn't set permissions at all
  // (undefined shouldn't read as "locked"); admins/owners can always post
  // regardless of the toggle, since they're the ones who'd have set it.
  const isGroupAdminHere = selectedGroup?.myRole === 'admin' || selectedGroup?.myRole === 'owner';
  const membersCanPost = selectedGroup?.permissions?.membersPost !== false;
  const postingLocked = !!selectedGroup && !isGroupAdminHere && !membersCanPost;

  const handlePost = async () => {
    if (!canPost) {
      showToast(hasPoll ? 'Write a question and add at least 2 options' : 'Write something or add a photo, file, or event');
      return;
    }
    if (!selectedGroupId) { showToast('Select a group to post to'); return; }
    if (postingLocked) { showToast('Only admins can post in this group'); return; }
    if (photosUploading) { showToast('Photos are still uploading'); return; }
    setPosting(true);
    const authorName = currentUser.name || user?.username || 'Member';

    // Build insert payload — only include extra columns if we have values,
    // so missing columns don't cause failures when SQL hasn't been run yet
    const payload = {
      content:        text || '',
      text:           text || '',
      group_id:       selectedGroupId,
      user_id:        user?.id,
      likes_count:    0,
      comment_count:  0,
      author_name:    authorName,
      author_initial: authorName[0]?.toUpperCase() || 'M',
      author_color:   currentUser?.avatarColor || deriveAvatarColor(user?.id || ''),
      avatar_url:     currentUser?.avatarUrl || null,
    };
    if (uploadedImageUrls.length) {
      payload.image_url = uploadedImageUrls[0];
      payload.images    = uploadedImageUrls;
    }
    if (fileUrl)           payload.file_url          = fileUrl;
    if (fileName)          payload.file_name         = fileName;
    if (linkedEvent?.id)   payload.linked_event_id   = linkedEvent.id;
    if (linkedEvent?.title)payload.linked_event_title= linkedEvent.title;
    if (hasPoll) {
      const opts = pollOpts.filter(o => o.trim());
      if (opts.length >= 2) {
        payload.poll_options = opts;
        payload.poll_expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      }
    }

    const { error } = await supabase.from('posts').insert(payload);
    setPosting(false);
    if (error) { showToast('Failed to post: ' + error.message); return; }
    showToast(`Posted to ${selectedGroup?.name || 'group'}`);
    goBack();
  };

  const setOpt = (i, val) => {
    const o = [...pollOpts]; o[i] = val; setPollOpts(o);
  };
  const removeOpt = (i) => setPollOpts(pollOpts.filter((_, idx) => idx !== i));
  const addOpt    = () => setPollOpts([...pollOpts, '']);

  const ATTACH = [
    {
      key: 'photo', label: 'Photo', sub: 'Add an image',
      iconBg: '#E4F7EC', iconColor: '#15A34A',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="14" rx="3" stroke="#15A34A" strokeWidth="2"/><circle cx="9" cy="10" r="1.9" stroke="#15A34A" strokeWidth="2"/><path d="m5 17 4.5-4 3 2.5L16 12l3 3.5" stroke="#15A34A" strokeWidth="2" strokeLinejoin="round"/></svg>,
      onClick: () => photoInputRef.current?.click(),
    },
    {
      key: 'poll', label: 'Poll', sub: 'Ask a question',
      iconBg: '#F1ECFF', iconColor: '#7C5CFF',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 20V10M12 20V4M18 20v-7" stroke="#7C5CFF" strokeWidth="2.2" strokeLinecap="round"/></svg>,
      onClick: () => { setHasPoll(true); if (pollOpts.length < 2) setPollOpts(['', '']); },
    },
    {
      key: 'event', label: 'Event', sub: 'Link an event',
      iconBg: '#E9F6FF', iconColor: C.primary,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke={C.primary} strokeWidth="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={C.primary} strokeWidth="2" strokeLinecap="round"/></svg>,
      onClick: () => setEventPickerOpen(true),
    },
    {
      key: 'file', label: 'File', sub: 'Attach a doc',
      iconBg: '#FFF6EC', iconColor: '#F59E0B',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M13 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.5L13 3.5Z" stroke="#F59E0B" strokeWidth="2" strokeLinejoin="round"/><path d="M13 3.5V9.5h6" stroke="#F59E0B" strokeWidth="2" strokeLinejoin="round"/></svg>,
      onClick: () => fileInputRef.current?.click(),
    },
  ];

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.94)', backdropFilter:'blur(16px)',
                    padding:'52px 14px 12px', display:'flex', alignItems:'center', gap:8,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', position:'relative', zIndex:4 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none', borderRadius:13,
          background:C.chip, display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="#39414F" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
        </button>

        <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>
          Create Post
        </div>

        <button onClick={handlePost} style={{
          height:40, padding:'0 18px', border:'none', borderRadius:13,
          cursor: canPost && !postingLocked ? 'pointer' : 'not-allowed',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          fontSize:15, fontWeight:800, flexShrink:0,
          background: canPost && !postingLocked ? 'linear-gradient(135deg,#19BFFF,#008FF0)' : '#E4E8EF',
          color: canPost && !postingLocked ? '#fff' : '#A8B0BD',
          boxShadow: canPost && !postingLocked ? '0 4px 10px rgba(2,162,240,0.3)' : 'none',
          transition: 'all .18s',
        }}>
          Post
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', padding:'16px 16px 30px' }}>

        {postingLocked && (
          <div style={{ display:'flex', alignItems:'center', gap:7, background:'#FFF6EC',
                        borderRadius:11, padding:'10px 13px', marginBottom:13 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
              <circle cx="12" cy="12" r="9" stroke="#F59E0B" strokeWidth="2"/>
              <path d="M12 8v5M12 16h.01" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize:14, fontWeight:600, color:'#92400E' }}>
              Only admins can post in {selectedGroup?.name || 'this group'}
            </span>
          </div>
        )}

        {/* Author + group picker */}
        <div style={{ display:'flex', alignItems:'center', gap:11 }}>
          <div style={{ width:44, height:44, borderRadius:'50%', flexShrink:0,
                        background: currentUser?.avatarUrl ? 'transparent' : (currentUser?.avatarColor || C.grad),
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:17, fontWeight:800, color:'#fff', overflow:'hidden' }}>
            {currentUser?.avatarUrl
              ? <img src={currentUser.avatarUrl} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
              : (currentUser?.name || user?.firstName || 'M')[0].toUpperCase()}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:16.5, fontWeight:800, color:C.ink }}>{currentUser?.name || user?.username || user?.firstName || 'Member'}</div>


            {/* Group picker pill */}
            <div style={{ position:'relative', display:'inline-block', marginTop:4 }}>
              <button onClick={() => setPickerOpen(v => !v)} style={{
                display:'inline-flex', alignItems:'center', gap:5,
                height:26, padding:'0 10px', border:`1.5px solid ${C.border}`,
                borderRadius:999, background:'#fff', cursor:'pointer',
                fontFamily:"'Montserrat',-apple-system,sans-serif",
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <circle cx="8" cy="9" r="2.2" stroke={C.muted} strokeWidth="1.8"/>
                  <circle cx="16" cy="9" r="2.2" stroke={C.muted} strokeWidth="1.8"/>
                  <path d="M4 18c0-2 1.5-3 4-3M20 18c0-2-1.5-3-4-3"
                        stroke={C.muted} strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
                <span style={{ fontSize:13.5, fontWeight:700, color:C.body }}>{selectedGroup?.name || 'Select a group'}</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="m6 9 6 6 6-6" stroke={C.subtle} strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* Group dropdown */}
              {pickerOpen && (
                <div style={{ position:'absolute', top:32, left:0, background:'#fff',
                              borderRadius:14, boxShadow:'0 6px 20px rgba(16,24,40,0.14)',
                              overflow:'hidden', zIndex:20, minWidth:200, maxHeight:280, overflowY:'auto' }}>
                  {myGroups.length === 0 && (
                    <div style={{ padding:'14px', fontSize:14.5, color:C.subtle }}>You haven't joined any groups yet</div>
                  )}
                  {myGroups.map(g => (
                    <div key={g.id} onClick={() => { setSelectedGroupId(g.id); setPickerOpen(false); }}
                      style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 14px',
                               cursor:'pointer', background: selectedGroupId===g.id ? '#EAF6FF' : '#fff',
                               borderBottom:`1px solid ${C.divider}` }}>
                      <div style={{ width:28, height:28, borderRadius:'50%', flexShrink:0,
                                    background: g.avatar_url ? 'transparent' : (g.logo_color || "linear-gradient(135deg,#19BFFF,#0098F0)"), display:'flex', alignItems:'center',
                                    justifyContent:'center', color:'#fff',
                                    fontSize:13, fontWeight:800, position:'relative',
                                    overflow:'hidden' }}>
                        {g.avatar_url
                          ? <img src={g.avatar_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                          : <>
                              <span>{g.initial || (g.name || "G")[0].toUpperCase()}</span>
                              <div style={{ position:'absolute', inset:0, background:
                                'repeating-linear-gradient(135deg,rgba(255,255,255,0.14) 0,rgba(255,255,255,0.14) 2px,transparent 2px,transparent 8px)'}}/>
                            </>}
                      </div>
                      <span style={{ fontSize:15, fontWeight:700,
                                     color: selectedGroupId===g.id ? C.primary : C.body }}>
                        {g.name}
                      </span>
                      {selectedGroupId===g.id && (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                          style={{ marginLeft:'auto', flexShrink:0 }}>
                          <path d="m5 12.5 4 4L19 7" stroke={C.primary} strokeWidth="2.4"
                                strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Textarea */}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Share something with the group…"
          style={{ width:'100%', boxSizing:'border-box', minHeight:120, border:'none',
                   background:'none', padding:'16px 2px 8px', fontSize:18, fontWeight:500,
                   lineHeight:1.55, color:C.body, outline:'none', resize:'none',
                   fontFamily:"'Montserrat',-apple-system,sans-serif" }}
        />

        {/* Hidden inputs */}
        <input ref={photoInputRef} type="file" accept="image/*" multiple style={{ display:'none' }} onChange={e => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (!files.length) return;
          const entries = files.map(file => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, previewUrl: URL.createObjectURL(file), url: null }));
          setImages(prev => [...prev, ...entries]);
          entries.forEach((entry, i) => {
            uploadImage(files[i], 'post-media', `posts/${user?.id}-${Date.now()}-${i}.jpg`)
              .then(url => setImages(prev => prev.map(img => img.id === entry.id ? { ...img, url } : img)))
              .catch(err => {
                showToast('Image upload failed: ' + (err?.message || 'Bucket not found'));
                setImages(prev => {
                  const target = prev.find(img => img.id === entry.id);
                  if (target) URL.revokeObjectURL(target.previewUrl);
                  return prev.filter(img => img.id !== entry.id);
                });
              });
          });
        }} />
        <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt" style={{ display:'none' }} onChange={async e => {
          const file = e.target.files?.[0]; if (!file) return;
          setFileName(file.name);
          setUploading(true);
          try {
            const path = `files/${user?.id}-${Date.now()}-${file.name}`;
            const { error } = await supabase.storage.from('post-media').upload(path, file, { upsert: true });
            if (error) throw error;
            const publicUrl = supabase.storage.from('post-media').getPublicUrl(path).data.publicUrl;
            setFileUrl(publicUrl);
          } catch (err) { showToast('File upload failed: ' + (err?.message || 'Bucket not found')); setFileName(null); }
          setUploading(false);
          e.target.value = '';
        }} />

        {/* Photo previews — horizontally scrollable, matches multi-photo pattern */}
        {images.length > 0 && (
          <div style={{ display:'flex', gap:8, overflowX:'auto', marginTop:8, paddingBottom:2 }}>
            {images.map(img => (
              <div key={img.id} style={{ position:'relative', width:120, height:120, flexShrink:0, borderRadius:14, overflow:'hidden' }}>
                <img src={img.previewUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
                {!img.url && <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:13, fontWeight:700 }}>Uploading…</div>}
                <button onClick={() => setImages(prev => {
                  const target = prev.find(x => x.id === img.id);
                  if (target) URL.revokeObjectURL(target.previewUrl);
                  return prev.filter(x => x.id !== img.id);
                })} style={{
                  position:'absolute', top:6, right:6, width:24, height:24, border:'none',
                  borderRadius:'50%', background:'rgba(14,23,38,0.6)',
                  display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* File preview */}
        {fileName && (
          <div style={{ display:'flex', alignItems:'center', gap:10, background:'#FFF6EC', borderRadius:13, padding:'11px 14px', marginTop:8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M13 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.5L13 3.5Z" stroke="#F59E0B" strokeWidth="2" strokeLinejoin="round"/><path d="M13 3.5V9.5h6" stroke="#F59E0B" strokeWidth="2" strokeLinejoin="round"/></svg>
            <span style={{ flex:1, fontSize:15, fontWeight:700, color:C.ink, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fileName}</span>
            {uploading && <span style={{ fontSize:13, color:C.subtle }}>Uploading…</span>}
            <button onClick={() => { setFileUrl(null); setFileName(null); }} style={{ border:'none', background:'none', cursor:'pointer', padding:0, flexShrink:0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke={C.subtle} strokeWidth="2.2" strokeLinecap="round"/></svg>
            </button>
          </div>
        )}

        {/* Linked event preview */}
        {linkedEvent && (
          <div style={{ display:'flex', alignItems:'center', gap:10, background:'#E9F6FF', borderRadius:13, padding:'11px 14px', marginTop:8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke={C.primary} strokeWidth="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={C.primary} strokeWidth="2" strokeLinecap="round"/></svg>
            <span style={{ flex:1, fontSize:15, fontWeight:700, color:C.ink }}>{linkedEvent.title}</span>
            <button onClick={() => setLinkedEvent(null)} style={{ border:'none', background:'none', cursor:'pointer', padding:0, flexShrink:0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke={C.subtle} strokeWidth="2.2" strokeLinecap="round"/></svg>
            </button>
          </div>
        )}

        {/* Poll builder */}
        {hasPoll && (
          <div style={{ background:'#fff', borderRadius:16,
                        boxShadow:'0 4px 14px rgba(16,24,40,0.05)', padding:15, marginTop:8 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                          marginBottom:11 }}>
              <span style={{ fontSize:15.5, fontWeight:800, color:C.ink }}>Poll</span>
              <button onClick={() => setHasPoll(false)} style={{
                border:'none', background:'none', cursor:'pointer',
                fontSize:14, fontWeight:700, color:C.danger,
                fontFamily:"'Montserrat',-apple-system,sans-serif",
              }}>Remove</button>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
              {pollOpts.map((v, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <input
                    value={v}
                    onChange={e => setOpt(i, e.target.value)}
                    placeholder={`Option ${i + 1}`}
                    style={{ flex:1, height:42, border:`1.5px solid ${C.border}`,
                             borderRadius:12, background:'#F7F8FB', padding:'0 13px',
                             fontSize:15.5, fontWeight:600, color:C.body, outline:'none',
                             fontFamily:"'Montserrat',-apple-system,sans-serif" }}
                  />
                  {pollOpts.length > 2 && (
                    <button onClick={() => removeOpt(i)} style={{
                      border:'none', background:'none', cursor:'pointer', padding:4, flexShrink:0,
                    }}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                        <path d="M6 6l12 12M18 6L6 18" stroke="#C5CBD6" strokeWidth="2.2"
                              strokeLinecap="round"/>
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
            {pollOpts.length < 4 && (
              <button onClick={addOpt} style={{
                display:'flex', alignItems:'center', gap:6, border:'none', background:'none',
                cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
                marginTop:11, padding:0,
              }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                  <path d="M12 5v14M5 12h14" stroke={C.primary} strokeWidth="2.2" strokeLinecap="round"/>
                </svg>
                <span style={{ fontSize:15, fontWeight:800, color:C.primary }}>Add option</span>
              </button>
            )}
          </div>
        )}

        {/* Attach toolbar */}
        <div style={{ fontSize:13, fontWeight:700, letterSpacing:0.4, textTransform:'uppercase',
                      color:C.subtle, margin:'22px 0 11px' }}>
          Add to your post
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
          {ATTACH.map(a => (
            <button key={a.key} onClick={a.onClick} style={{
              display:'flex', alignItems:'center', gap:11,
              border:`1.5px solid ${C.border}`, borderRadius:15, background:'#fff',
              padding:13, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
              boxShadow:'0 3px 10px rgba(16,24,40,0.04)',
              opacity: (a.key==='photo'&&hasPhoto)||(a.key==='poll'&&hasPoll)||(a.key==='file'&&hasFile)||(a.key==='event'&&!!linkedEvent) ? 0.5 : 1,
            }}>
              <div style={{ width:38, height:38, borderRadius:12, flexShrink:0,
                            display:'flex', alignItems:'center', justifyContent:'center',
                            background:a.iconBg }}>
                {a.icon}
              </div>
              <div style={{ flex:1, minWidth:0, textAlign:'left' }}>
                <div style={{ fontSize:15.5, fontWeight:800, color:C.ink }}>{a.label}</div>
                <div style={{ fontSize:13, color:C.subtle, marginTop:1 }}>{a.sub}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Tap outside group picker to close */}
      {pickerOpen && (
        <div onClick={() => setPickerOpen(false)}
          style={{ position:'absolute', inset:0, zIndex:10 }}/>
      )}

      {/* Event picker sheet */}
      {eventPickerOpen && (
        <div style={{ position:'absolute', inset:0, zIndex:30, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'flex-end' }}
          onClick={() => setEventPickerOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width:'100%', background:'#fff', borderRadius:'22px 22px 0 0', padding:'20px 16px 40px', maxHeight:'60vh', overflowY:'auto' }}>
            <div style={{ fontSize:17, fontWeight:800, color:C.ink, marginBottom:14 }}>Link an Event</div>
            {linkableEvents.length === 0
              ? <div style={{ color:C.subtle, fontSize:15, textAlign:'center', padding:24 }}>No events available</div>
              : linkableEvents.map(ev => (
                <div key={ev.id} onClick={() => { setLinkedEvent(ev); setEventPickerOpen(false); }}
                  style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom:`1px solid ${C.divider}`, cursor:'pointer' }}>
                  <div style={{ width:42, height:42, borderRadius:12, background:'linear-gradient(135deg,#19BFFF,#0098F0)', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="#fff" strokeWidth="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:15, fontWeight:700, color:C.ink }}>{ev.title}</div>
                    <div style={{ fontSize:13, color:C.subtle, marginTop:2 }}>{ev.date}</div>
                  </div>
                  {linkedEvent?.id === ev.id && <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4 4L19 7" stroke={C.primary} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
              ))
            }
          </div>
        </div>
      )}

    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// SCREEN: HELP CENTER
// ─────────────────────────────────────────────────────────────
function HelpCenterScreen({ goBack, navigate, showToast }) {
  const FAQS = [
    // Events & Tickets
    { topic:'Events & Tickets', q:'How do I find events near me?', a:"Tap the Events tab at the bottom of the screen. Browse by category using the chips at the top, or use the search bar to find events by name, organiser, or location." },
    { topic:'Events & Tickets', q:'How do I RSVP or buy a ticket?', a:"Open any event and tap \"Get Tickets\" or \"RSVP\". Choose your ticket type and quantity, complete checkout, and your ticket with QR code will appear instantly in My Tickets on your profile." },
    { topic:'Events & Tickets', q:'Where do I find my tickets?', a:"Go to your Profile tab → My Tickets. All purchased and RSVP'd tickets are listed there with their QR codes ready for check-in." },
    { topic:'Events & Tickets', q:'Can I get a refund on a ticket?', a:"Refunds depend on the event organiser's policy. If refunds are allowed, go to My Tickets → tap the ticket → Request Refund. Requests must usually be made at least 24 hours before the event." },
    { topic:'Events & Tickets', q:'How does check-in work at the door?', a:"Show your QR code from My Tickets to the event organiser at the door. They'll scan it to verify and check you in instantly." },
    { topic:'Events & Tickets', q:'Can I transfer my ticket to someone else?', a:"Ticket transfers are not supported yet. If you can't attend, check the event's refund policy or contact the organiser directly." },
    { topic:'Events & Tickets', q:'Who can create events on Riply?', a:"Verified organisers and group admins can publish events. If you'd like to host an event, reach out to us via the Send Feedback option in your profile settings." },
    // Groups & Spaces
    { topic:'Groups & Spaces', q:'How do I join a group?', a:"Go to the Discover tab and browse or search for groups. Tap a group to open it, then tap \"Join\". Private groups require admin approval — you'll get a notification once accepted." },
    { topic:'Groups & Spaces', q:'How do I leave a group?', a:"Open the group page, tap the three-dot menu in the top right, and select \"Leave Group\". You can rejoin at any time unless the group is private." },
    { topic:'Groups & Spaces', q:'What are Spaces?', a:"Spaces are live audio or video rooms hosted by students or organisers. You can join an active Space from the Spaces tab, listen in, or participate. Spaces end automatically when the host leaves." },
    { topic:'Groups & Spaces', q:'How do I join a Space?', a:"Go to the Spaces tab, find a Space that's currently live or scheduled, and tap \"Join Space\". You'll be added to the participant list in real time." },
    { topic:'Groups & Spaces', q:'Can I post in any group?', a:"You can post in groups you've joined. Some groups may have posting restrictions set by the admin — for example, only admins can post in announcement-only groups." },
    { topic:'Groups & Spaces', q:'How do I create a group?', a:"Group creation is currently available to verified accounts. Tap the \"+\" icon on the Discover tab or contact us via Send Feedback if you'd like to set up a group for your club or society." },
    // Account
    { topic:'Account', q:'How do I update my profile?', a:"Go to the Profile tab → tap your name or avatar at the top → Edit Profile. You can update your name, university, year, programme, bio, and profile photo." },
    { topic:'Account', q:'How do I change my password?', a:"Go to Profile & Settings → Privacy & Security → Change Password. Enter your current password and your new one twice, then tap Save." },
    { topic:'Account', q:'How do I make my profile private?', a:"Go to Profile & Settings → Privacy & Security → toggle on Private Profile. When private, only people you approve can see your activity and details." },
    { topic:'Account', q:'How do I delete my account?', a:"Account deletion is handled by our support team to ensure your data is fully removed. Email us at riplyapp@outlook.com with the subject \"Delete My Account\" and we'll process it within 7 days." },
    { topic:'Account', q:'I forgot my password — what do I do?', a:"On the login screen tap \"Forgot Password\". Enter your email and we'll send a reset link. If you signed up with Google or Apple, use that login method instead." },
    { topic:'Account', q:'Can I change my university after signing up?', a:"Yes — go to Edit Profile and update the University field. This helps us show you relevant events and groups for your campus." },
    // Payments
    { topic:'Payments', q:'What payment methods are accepted?', a:"Riply accepts major credit and debit cards. Apple Pay and Google Pay support is coming soon. All payments are processed securely." },
    { topic:'Payments', q:'Is it safe to pay through Riply?', a:"Yes. All payments are encrypted and processed through a secure payment provider. Riply never stores your full card details." },
    { topic:'Payments', q:'Where can I see my payment history?', a:"Go to Profile & Settings → Payment Methods → Payment History to see all past transactions and receipts." },
    { topic:'Payments', q:'I was charged but didn\'t receive my ticket — what do I do?', a:"This can happen if your connection dropped during checkout. Check My Tickets first — your ticket may already be there. If not, email riplyapp@outlook.com with your order details and we'll resolve it quickly." },
    { topic:'Payments', q:'Are there booking fees on top of the ticket price?', a:"Any fees are shown clearly during checkout before you confirm payment. The price you see on the event page is the base ticket price." },
  ];
  const TOPICS = [
    { title:'Events & Tickets', sub:'Finding, RSVP, check-in',    iconBg:'#E9F6FF', iconColor:C.primary,   icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 1.8 1.8 0 0 0 0 3.4A1.8 1.8 0 0 0 20 16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 1.8 1.8 0 0 0 0-3.6A1.8 1.8 0 0 0 4 9Z" stroke={C.primary} strokeWidth="1.9" strokeLinejoin="round"/></svg> },
    { title:'Groups & Spaces',  sub:'Joining, posting, live rooms', iconBg:'#E4F7EC', iconColor:'#15A34A',  icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="9" r="2.6" stroke="#15A34A" strokeWidth="1.9"/><circle cx="16" cy="9" r="2.6" stroke="#15A34A" strokeWidth="1.9"/><path d="M3.5 18c0-2.4 2-3.8 4.5-3.8M20.5 18c0-2.4-2-3.8-4.5-3.8M9 18c0-2 1.4-3.2 3-3.2s3 1.2 3 3.2" stroke="#15A34A" strokeWidth="1.9" strokeLinecap="round"/></svg> },
    { title:'Account',          sub:'Profile, password, privacy',  iconBg:'#F1ECFF', iconColor:'#7C5CFF',  icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke="#7C5CFF" strokeWidth="1.9"/><path d="M5 20c0-3.6 3-5.6 7-5.6s7 2 7 5.6" stroke="#7C5CFF" strokeWidth="1.9" strokeLinecap="round"/></svg> },
    { title:'Payments',         sub:'Cards, receipts, refunds',    iconBg:'#FFF6EC', iconColor:'#F59E0B',  icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="6" width="17" height="12" rx="3" stroke="#F59E0B" strokeWidth="1.9"/><path d="M3.5 10h17" stroke="#F59E0B" strokeWidth="1.9"/></svg> },
  ];

  const [query,     setQuery]     = useState('');
  const [openIdx,   setOpenIdx]   = useState(-1);
  const [activeTopic, setActiveTopic] = useState(null);

  const q = query.trim().toLowerCase();
  const filtered = FAQS.filter(f => {
    const matchesTopic = !activeTopic || f.topic === activeTopic;
    const matchesQuery = !q || (f.q + ' ' + f.a).toLowerCase().includes(q);
    return matchesTopic && matchesQuery;
  });

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background:C.pageBg,
                  fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink:0, background:'#fff', padding:'52px 14px 12px',
                    display:'flex', alignItems:'center', gap:8,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.06)', zIndex:4 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none', borderRadius:13,
          background:C.chip, display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Help Center</div>
        <div style={{ width:40 }}/>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'18px 16px 30px' }}>
        {/* Search */}
        <div style={{ display:'flex', alignItems:'center', gap:11, background:'#fff',
                      borderRadius:16, padding:'13px 15px',
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
            <circle cx="11" cy="11" r="7" stroke="#8A93A6" strokeWidth="2"/>
            <path d="m20 20-3.2-3.2" stroke="#8A93A6" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search help articles…"
            style={{ flex:1, border:'none', background:'none', fontSize:16.5, fontWeight:600,
                     color:C.body, outline:'none',
                     fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
          {query && (
            <button onClick={() => setQuery('')} style={{ border:'none', background:'none',
              cursor:'pointer', padding:0, flexShrink:0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke={C.subtle} strokeWidth="2.2" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>

        {/* Quick topics grid */}
        {!query && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11, marginTop:16 }}>
            {TOPICS.map((t,i) => {
              const active = activeTopic === t.title;
              return (
                <button key={i} onClick={() => { setActiveTopic(active ? null : t.title); setOpenIdx(-1); }} style={{
                  display:'flex', flexDirection:'column', gap:9, border: active ? `2px solid ${t.iconColor}` : '2px solid transparent',
                  borderRadius:16, padding:15, cursor:'pointer', textAlign:'left',
                  fontFamily:"'Montserrat',-apple-system,sans-serif",
                  background: active ? t.iconBg : '#fff',
                  boxShadow:'0 4px 14px rgba(16,24,40,0.05)',
                }}>
                  <div style={{ width:40, height:40, borderRadius:12, display:'flex',
                                alignItems:'center', justifyContent:'center',
                                background: active ? '#fff' : t.iconBg }}>
                    {t.icon}
                  </div>
                  <div style={{ fontSize:15.5, fontWeight:800, color: active ? t.iconColor : C.ink }}>{t.title}</div>
                  <div style={{ fontSize:13, color:C.subtle, lineHeight:1.3 }}>{t.sub}</div>
                </button>
              );
            })}
          </div>
        )}

        {/* FAQ */}
        <div style={{ fontSize:13, fontWeight:800, letterSpacing:0.6, textTransform:'uppercase',
                      color:C.subtle, margin:'24px 4px 10px' }}>
          {query ? `Results for "${query}"` : activeTopic ? activeTopic : 'Frequently Asked'}
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign:'center', padding:'30px 24px', color:C.subtle, fontSize:15 }}>
            No articles match "{query}". Try contacting support below.
          </div>
        ) : (
          <div style={{ background:'#fff', borderRadius:18,
                        boxShadow:'0 4px 14px rgba(16,24,40,0.05)', overflow:'hidden' }}>
            {filtered.map((f, i) => {
              const open = openIdx === i;
              return (
                <div key={i} style={{ borderBottom: i < filtered.length-1 ? `1px solid ${C.divider}` : 'none' }}>
                  <button onClick={() => setOpenIdx(open ? -1 : i)} style={{
                    display:'flex', alignItems:'center', gap:12, width:'100%', border:'none',
                    background:'none', padding:15, cursor:'pointer', textAlign:'left',
                    fontFamily:"'Montserrat',-apple-system,sans-serif",
                  }}>
                    <span style={{ flex:1, fontSize:16, fontWeight:700, color:C.ink,
                                   lineHeight:1.35 }}>{f.q}</span>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                      style={{ flexShrink:0, transition:'transform .2s',
                               transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                      <path d="m9 6 6 6-6 6" stroke={C.subtle} strokeWidth="2.2"
                            strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  {open && (
                    <div style={{ padding:'0 15px 16px', fontSize:15, lineHeight:1.55,
                                  color:'#6B7385' }}>{f.a}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Contact */}
        <div style={{ fontSize:13, fontWeight:800, letterSpacing:0.6, textTransform:'uppercase',
                      color:C.subtle, margin:'24px 4px 10px' }}>Still need help?</div>
        <div style={{ display:'flex', flexDirection:'column', gap:11 }}>
          {[
            { title:'Email Support', sub:'riplyapp@outlook.com', iconBg:'#F1ECFF',
              icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="17" height="13" rx="3" stroke="#7C5CFF" strokeWidth="1.9"/><path d="m4.5 7 7.5 5.5L19.5 7" stroke="#7C5CFF" strokeWidth="1.9" strokeLinejoin="round"/></svg>,
              onClick:() => navigate('feedback') },
          ].map((item,i) => (
            <button key={i} onClick={item.onClick} style={{
              display:'flex', alignItems:'center', gap:13, background:'#fff', border:'none',
              borderRadius:16, padding:15, cursor:'pointer', textAlign:'left',
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              boxShadow:'0 4px 14px rgba(16,24,40,0.05)',
            }}>
              <div style={{ width:42, height:42, borderRadius:12, flexShrink:0,
                            background:item.iconBg, display:'flex', alignItems:'center',
                            justifyContent:'center' }}>{item.icon}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:16, fontWeight:800, color:C.ink }}>{item.title}</div>
                <div style={{ fontSize:13.5, color:C.subtle, marginTop:2 }}>{item.sub}</div>
              </div>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                <path d="m9 6 6 6-6 6" stroke="#C5CBD6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: SEND FEEDBACK
// ─────────────────────────────────────────────────────────────
function FeedbackScreen({ goBack, showToast }) {
  const CATS    = ['Bug report','Feature idea','Events','Groups','Payments','Other'];
  const LABELS  = ['','Poor','Fair','Good','Great','Excellent!'];
  const { user } = useUser();

  const [rating,    setRating]    = useState(0);
  const [category,  setCategory]  = useState('');
  const [message,   setMessage]   = useState('');
  const [attached,  setAttached]  = useState(false);
  const [sent,      setSent]      = useState(false);

  const canSubmit = rating > 0 && message.trim().length > 0;

  const handleSubmit = async () => {
    if (rating === 0)          { showToast('Please add a star rating'); return; }
    if (!message.trim())       { showToast('Tell us a bit more first'); return; }
    const { error } = await supabase.from('feedback').insert({
      user_id:  user?.id || null,
      rating,
      category: category || null,
      message:  message.trim(),
    });
    if (error) { showToast('Failed to send feedback. Try again.'); return; }
    setSent(true);
  };

  if (sent) return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background:C.pageBg,
                  fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      <div style={{ flexShrink:0, background:'#fff', padding:'52px 14px 12px',
                    display:'flex', alignItems:'center', gap:8,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.06)' }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none', borderRadius:13,
          background:C.chip, display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Send Feedback</div>
        <div style={{ width:40 }}/>
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center',
                    textAlign:'center', padding:'60px 24px 0', overflowY:'auto' }}>
        <div style={{ width:96, height:96, borderRadius:'50%', background:'#E4F7EC',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      animation:'fbPop .5s cubic-bezier(.2,.8,.2,1)' }}>
          <div style={{ width:62, height:62, borderRadius:'50%',
                        background:'linear-gradient(135deg,#22C55E,#15A34A)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        boxShadow:'0 8px 20px rgba(21,163,74,0.4)' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="m5 12.5 4.5 4.5L19 7" stroke="#fff" strokeWidth="3"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
        <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.5, color:C.ink,
                      marginTop:22 }}>Thank you!</div>
        <div style={{ fontSize:15.5, lineHeight:1.55, color:'#7B8499', marginTop:9,
                      maxWidth:280 }}>
          Your feedback has been sent to the Riply team. We read every message and use it to improve the app.
        </div>
        <button onClick={goBack} style={{
          display:'flex', alignItems:'center', justifyContent:'center', width:'100%',
          height:52, marginTop:28, border:'none', borderRadius:16,
          background:C.grad, color:'#fff', fontSize:18, fontWeight:800, cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          boxShadow:'0 8px 20px rgba(2,162,240,0.4)',
        }}>
          Back to Settings
        </button>
        <button onClick={() => setSent(false)} style={{
          border:'none', background:'none', cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          fontSize:15.5, fontWeight:700, color:C.primary, marginTop:16,
        }}>
          Send more feedback
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background:C.pageBg,
                  fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink:0, background:'#fff', padding:'52px 14px 12px',
                    display:'flex', alignItems:'center', gap:8,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.06)', zIndex:4 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none', borderRadius:13,
          background:C.chip, display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Send Feedback</div>
        <div style={{ width:40 }}/>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 16px 30px' }}>
        <div style={{ fontSize:22, fontWeight:800, letterSpacing:-0.4, color:C.ink }}>
          How was your experience?
        </div>
        <div style={{ fontSize:15, color:'#7B8499', marginTop:6, lineHeight:1.5 }}>
          Your feedback helps us make Riply better for campus life.
        </div>

        {/* Star rating */}
        <div style={{ display:'flex', justifyContent:'center', gap:10, marginTop:22 }}>
          {[1,2,3,4,5].map(n => (
            <button key={n} onClick={() => setRating(n)} style={{
              border:'none', background:'none', cursor:'pointer', padding:2,
            }}>
              <svg width="34" height="34" viewBox="0 0 24 24"
                style={{ transition:'transform .15s', transform: n<=rating ? 'scale(1.1)' : 'scale(1)' }}>
                <path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.8 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3Z"
                      fill={n<=rating ? '#FFB020' : 'none'}
                      stroke={n<=rating ? '#F59E0B' : '#D4D9E2'}
                      strokeWidth="1.6" strokeLinejoin="round"/>
              </svg>
            </button>
          ))}
        </div>
        <div style={{ textAlign:'center', fontSize:15, fontWeight:700, color:C.primary,
                      marginTop:10, height:18 }}>
          {LABELS[rating] || ''}
        </div>

        {/* Category */}
        <div style={{ fontSize:13, fontWeight:800, letterSpacing:0.5, textTransform:'uppercase',
                      color:C.subtle, margin:'22px 0 10px' }}>
          What's this about?
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:9 }}>
          {CATS.map(c => (
            <button key={c} onClick={() => setCategory(c)} style={{
              border: category===c ? 'none' : `1.5px solid ${C.border}`,
              cursor:'pointer', height:38, padding:'0 16px', borderRadius:999,
              fontSize:15, fontWeight:700,
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              background: category===c ? C.primary : '#fff',
              color: category===c ? '#fff' : C.muted,
              boxShadow: category===c ? '0 4px 12px rgba(2,162,240,0.3)' : 'none',
            }}>{c}</button>
          ))}
        </div>

        {/* Message */}
        <div style={{ fontSize:13, fontWeight:800, letterSpacing:0.5, textTransform:'uppercase',
                      color:C.subtle, margin:'22px 0 10px' }}>
          Tell us more
        </div>
        <textarea value={message} onChange={e => setMessage(e.target.value)}
          placeholder="Share details, ideas, or a bug you ran into…"
          style={{ width:'100%', boxSizing:'border-box', minHeight:120,
                   border:`1.5px solid ${C.border}`, borderRadius:16, background:'#fff',
                   padding:14, fontSize:16, fontWeight:500, lineHeight:1.55,
                   color:C.body, outline:'none', resize:'none',
                   fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>

        {/* Screenshot */}
        <button onClick={() => setAttached(v => !v)} style={{
          display:'flex', alignItems:'center', gap:10, width:'100%',
          border:`1.5px dashed ${attached ? C.primary : '#C7D2E0'}`,
          borderRadius:14, background: attached ? '#EAF6FF' : '#fff',
          padding:14, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
          marginTop:11,
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="3.5" y="6" width="17" height="13" rx="3"
                  stroke={attached ? C.primary : C.primary} strokeWidth="1.9"/>
            <circle cx="12" cy="12.5" r="3"
                    stroke={attached ? C.primary : C.primary} strokeWidth="1.9"/>
          </svg>
          <span style={{ flex:1, textAlign:'left', fontSize:15.5, fontWeight:700,
                         color: attached ? C.primary : C.muted }}>
            {attached ? 'Screenshot attached ✓' : 'Attach a screenshot (optional)'}
          </span>
        </button>

        {/* Submit */}
        <button onClick={handleSubmit} style={{
          width:'100%', height:52, marginTop:22, border:'none', borderRadius:16,
          fontSize:18, fontWeight:800, cursor: canSubmit ? 'pointer' : 'not-allowed',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          background: canSubmit ? 'linear-gradient(135deg,#19BFFF,#008FF0)' : '#E4E8EF',
          color: canSubmit ? '#fff' : '#A8B0BD',
          boxShadow: canSubmit ? '0 8px 20px rgba(2,162,240,0.4)' : 'none',
        }}>Submit Feedback</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: TERMS & PRIVACY
// ─────────────────────────────────────────────────────────────
function LegalScreen({ goBack, showToast }) {
  const TERMS = [
    { heading:'1. Acceptance of Terms', body:'By creating a Riply account or using the app, you agree to these Terms of Service. Riply is provided for students, organizers, and campus staff to discover and manage campus events and communities.' },
    { heading:'2. Eligibility', body:'You must be a current student, faculty, or staff member of a participating institution and provide a valid school email address. You are responsible for keeping your login credentials secure.' },
    { heading:'3. Events & Tickets', body:'Only verified organizers and group admins may publish events. Ticket sales are processed through our payment partners. Refund eligibility is set by each organizer and shown at checkout.' },
    { heading:'4. Community Conduct', body:"You agree to follow each group's rules and to treat other members respectfully. Harassment, spam, and illegal activity may result in content removal, suspension, or a permanent ban." },
    { heading:'5. Content Ownership', body:'You retain rights to the content you post. By posting, you grant Riply a license to display that content within the app to other members of the relevant group or event.' },
    { heading:'6. Termination', body:'You may delete your account at any time from Settings. We may suspend accounts that violate these terms or pose a risk to the campus community.' },
  ];
  const PRIVACY = [
    { heading:'1. Information We Collect', body:'We collect your name, school email, profile details, and activity within the app — such as events you RSVP to, groups you join, and posts you create.' },
    { heading:'2. How We Use Your Data', body:"Your data powers your personalized feed, event recommendations, and engagement analytics shown to the organizers of events and groups you participate in. We never sell your personal data." },
    { heading:'3. What Organizers See', body:'Event organizers and group admins can see aggregate engagement (RSVPs, attendance, views) and the names of members who join or attend. They cannot see your password or payment details.' },
    { heading:'4. Location Services', body:'If you enable location, we use it to surface nearby events and spaces. You can turn this off anytime in Settings → Preferences → Location Services.' },
    { heading:'5. Data Security', body:'We use encryption in transit and at rest, and limit internal access to your data. No system is perfectly secure, so please use a strong, unique password.' },
    { heading:'6. Your Rights', body:'You can view, edit, export, or delete your data from Settings → Privacy & Security → Data & Permissions. Deletion requests are processed within 30 days.' },
  ];

  const [tab, setTab] = useState('terms');
  const sections = tab === 'terms' ? TERMS : PRIVACY;

  const tabStyle = (id) => ({
    border:'none', background:'none', cursor:'pointer',
    fontFamily:"'Montserrat',-apple-system,sans-serif",
    padding:'0 0 12px', fontSize:15.5,
    fontWeight: id===tab ? 800 : 600,
    color: id===tab ? C.primary : C.subtle,
    borderBottom: `2.5px solid ${id===tab ? C.primary : 'transparent'}`,
    marginBottom: -1,
  });

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background:C.pageBg,
                  fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink:0, background:'#fff', padding:'52px 14px 0',
                    boxShadow:'0 1px 0 rgba(16,24,40,0.04)', zIndex:4 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, paddingBottom:12 }}>
          <button onClick={goBack} style={{ width:40, height:40, border:'none', borderRadius:13,
            background:C.chip, display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', flexShrink:0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                        letterSpacing:-0.3, color:C.ink }}>Terms &amp; Privacy</div>
          <div style={{ width:40 }}/>
        </div>
        {/* Tabs */}
        <div style={{ display:'flex', gap:26, padding:'0 4px',
                      borderBottom:`1px solid ${C.divider}` }}>
          <button onClick={() => setTab('terms')}   style={tabStyle('terms')}>Terms of Service</button>
          <button onClick={() => setTab('privacy')} style={tabStyle('privacy')}>Privacy Policy</button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 18px 30px' }}>
        <div style={{ fontSize:13.5, fontWeight:700, color:C.subtle, marginBottom:16 }}>
          Last updated June 1, 2026
        </div>
        {sections.map((s, i) => (
          <div key={i} style={{ marginBottom:20 }}>
            <div style={{ fontSize:17, fontWeight:800, color:C.ink, marginBottom:7 }}>
              {s.heading}
            </div>
            <div style={{ fontSize:15, lineHeight:1.62, color:'#5B6473' }}>{s.body}</div>
          </div>
        ))}
        <div style={{ background:'#fff', borderRadius:14, padding:15,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)', marginTop:6 }}>
          <div style={{ fontSize:14.5, lineHeight:1.55, color:'#7B8499' }}>
            Questions about these terms? Contact us at{' '}
            <span style={{ color:C.primary, fontWeight:700 }}>legal@riply.app</span>.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: ABOUT RIPLY
// ─────────────────────────────────────────────────────────────
function AboutScreen({ goBack, navigate, showToast }) {
  const STATS = [
    { value:'42K+',  label:'Students'     },
    { value:'1.2K+', label:'Events hosted'},
    { value:'380+',  label:'Campus groups'},
  ];
  const LINKS = [
    { title:'Rate Riply',          iconBg:'#E9F6FF', icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.8 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3Z" stroke={C.primary} strokeWidth="1.8" strokeLinejoin="round"/></svg>, onClick:() => showToast('Opening the App Store…') },
    { title:'Terms & Privacy',     iconBg:'#E9F6FF', icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M6.5 3.5h7l4 4V20a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" stroke={C.primary} strokeWidth="1.8" strokeLinejoin="round"/><path d="M13 3.5V8h4" stroke={C.primary} strokeWidth="1.8" strokeLinejoin="round"/></svg>, onClick:() => navigate('legal') },
    { title:'Open Source Licenses',iconBg:'#E9F6FF', icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 20S4 15 4 9.5A3.8 3.8 0 0 1 12 7a3.8 3.8 0 0 1 8 2.5C20 15 12 20 12 20Z" stroke={C.primary} strokeWidth="1.8" strokeLinejoin="round"/></svg>, onClick:() => showToast('Viewing licenses') },
    { title:'Visit riply.app',     iconBg:'#E9F6FF', icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke={C.primary} strokeWidth="1.8"/><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" stroke={C.primary} strokeWidth="1.8"/></svg>, onClick:() => showToast('Opening riply.app') },
  ];
  const SOCIALS = [
    { label:'Instagram', icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="5" stroke={C.primary} strokeWidth="1.9"/><circle cx="12" cy="12" r="3.6" stroke={C.primary} strokeWidth="1.9"/><circle cx="16.5" cy="7.5" r="1.1" fill={C.primary}/></svg> },
    { label:'X / Twitter', icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 5l14 14M19 5 5 19" stroke={C.primary} strokeWidth="2" strokeLinecap="round"/></svg> },
    { label:'Website', icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke={C.primary} strokeWidth="1.9"/><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" stroke={C.primary} strokeWidth="1.9"/></svg> },
  ];

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background:C.pageBg,
                  fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink:0, background:'#fff', padding:'52px 14px 12px',
                    display:'flex', alignItems:'center', gap:8,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.06)', zIndex:4 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none', borderRadius:13,
          background:C.chip, display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>About Riply</div>
        <div style={{ width:40 }}/>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'0 0 30px' }}>
        {/* Hero banner */}
        <div style={{ position:'relative', overflow:'hidden',
                      background:'linear-gradient(160deg,#0E84E0,#19BFFF 60%,#2FD2D2)',
                      padding:'36px 22px 30px', textAlign:'center' }}>
          <div style={{ position:'absolute', inset:0, background:
            'repeating-linear-gradient(135deg,rgba(255,255,255,0.06) 0,rgba(255,255,255,0.06) 2px,transparent 2px,transparent 20px)'}}/>
          <div style={{ position:'absolute', width:200, height:200, borderRadius:'50%',
                        background:'rgba(255,255,255,0.1)', top:-70, right:-60 }}/>
          {/* Logo */}
          <div style={{ position:'relative', width:84, height:84,
                        display:'flex', alignItems:'center', justifyContent:'center',
                        margin:'0 auto' }}>
            <RiplyMark size={84} white />
          </div>
          <div style={{ position:'relative', fontSize:30, fontWeight:800, letterSpacing:0.5,
                        color:'#fff', marginTop:12 }}>RIPLY</div>
          <div style={{ position:'relative', fontSize:14, fontWeight:700, letterSpacing:1.5,
                        color:'rgba(255,255,255,0.9)', marginTop:6 }}>
            CAMPUS CONNECTIONS MADE EASY
          </div>
          <div style={{ position:'relative', display:'inline-flex', alignItems:'center',
                        height:26, padding:'0 13px', borderRadius:999,
                        background:'rgba(255,255,255,0.2)', fontSize:13.5, fontWeight:700,
                        color:'#fff', marginTop:14 }}>
            Version 1.0.0
          </div>
        </div>

        {/* Mission */}
        <div style={{ padding:'22px 18px 0' }}>
          <div style={{ fontSize:15.5, lineHeight:1.62, color:'#5B6473' }}>
            Riply is the home for campus life. We help students discover events, join clubs and communities, buy tickets, and stay connected — while giving organizers the tools and insights to grow engagement on campus.
          </div>
        </div>

        {/* Stats */}
        <div style={{ display:'flex', gap:10, padding:'20px 18px 0' }}>
          {STATS.map(s => (
            <div key={s.label} style={{ flex:1, background:'#fff', borderRadius:16,
                                         padding:'15px 8px', textAlign:'center',
                                         boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
              <div style={{ fontSize:22, fontWeight:800, color:C.primary,
                            letterSpacing:-0.5 }}>{s.value}</div>
              <div style={{ fontSize:12.5, fontWeight:600, color:C.subtle,
                            marginTop:3 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Links */}
        <div style={{ padding:'24px 16px 0' }}>
          <div style={{ background:'#fff', borderRadius:18,
                        boxShadow:'0 4px 14px rgba(16,24,40,0.05)', overflow:'hidden' }}>
            {LINKS.map((l, i) => (
              <button key={i} onClick={l.onClick} style={{
                display:'flex', alignItems:'center', gap:13, width:'100%', border:'none',
                background:'none', padding:'14px 15px', cursor:'pointer',
                fontFamily:"'Montserrat',-apple-system,sans-serif",
                borderBottom: i < LINKS.length-1 ? `1px solid ${C.divider}` : 'none',
              }}>
                <div style={{ width:38, height:38, borderRadius:11, flexShrink:0,
                              background:l.iconBg, display:'flex', alignItems:'center',
                              justifyContent:'center' }}>{l.icon}</div>
                <span style={{ flex:1, textAlign:'left', fontSize:16.5, fontWeight:700,
                               color:C.ink }}>{l.title}</span>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                  <path d="m9 6 6 6-6 6" stroke="#C5CBD6" strokeWidth="2.2"
                        strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            ))}
          </div>
        </div>

        {/* Social */}
        <div style={{ display:'flex', justifyContent:'center', gap:14, padding:'26px 0 0' }}>
          {SOCIALS.map(s => (
            <button key={s.label} onClick={() => showToast('Opening ' + s.label)} style={{
              width:46, height:46, border:'none', borderRadius:14, background:'#fff',
              display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
              boxShadow:'0 4px 14px rgba(16,24,40,0.06)',
            }}>{s.icon}</button>
          ))}
        </div>

        <div style={{ textAlign:'center', fontSize:13, color:'#B6BCC8', marginTop:22,
                      lineHeight:1.6, padding:'0 24px' }}>
          Made with care for campus communities.<br/>© 2026 Riply. All rights reserved.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: FILTERS
// ─────────────────────────────────────────────────────────────
function FiltersScreen({ from, filters: initialFilters, setFilters: applyFilters, goBack, showToast }) {
  const SECTIONS = [
    {
      id: 'date', title: 'Date',
      opts: ['Today','Tomorrow','This Week','This Month','Next Month'],
    },
    {
      id: 'location', title: 'Location',
      opts: ['On-Campus','Off-Campus','Online','Bannatyne Campus'],
    },
    {
      id: 'faculty', title: 'Faculty',
      opts: ['Arts','Science','Asper','Economics','Engineering','Architecture','Nursing','Other'],
    },
    {
      id: 'interests', title: 'Interests',
      opts: ['Academic','Sports & Fitness','Cultural','Entrepreneurship','Personal Development','Community','Volunteering','Innovation','Social','Career'],
    },
    {
      id: 'price', title: 'Price',
      opts: ['Free','$10–$20','$20–$30','$30–$40','$40–$50','$50+'],
    },
  ];

  const [open,     setOpen]     = useState({ date:true, location:true, faculty:true, interests:true, price:true });
  const [selected, setSelected] = useState(initialFilters || {});   // `${secId}:${opt}` → true

  const toggleSection = id  => setOpen(s => ({ ...s, [id]: !s[id] }));
  const toggleChip    = key => setSelected(s => {
    const n = { ...s };
    n[key] ? delete n[key] : (n[key] = true);
    return n;
  });
  const clearAll = () => setSelected({});

  const count       = Object.keys(selected).length;
  const applyLabel  = count ? `Apply Filters (${count})` : 'Apply Filters';
  const fromLabel   = from === 'spaces' ? 'spaces' : from === 'discover' ? 'groups' : 'events';

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:'#EEF1F6', fontFamily:"'Montserrat',-apple-system,sans-serif",
                  position:'relative' }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ flexShrink:0, background:'rgba(238,241,246,0.94)', backdropFilter:'blur(16px)',
                    padding:'50px 16px 12px', display:'flex', alignItems:'center', gap:10,
                    position:'relative', zIndex:4 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none', borderRadius:13,
          background:'#fff', display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0, boxShadow:'0 2px 6px rgba(16,24,40,0.06)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M14 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span style={{ fontSize:23, fontWeight:800, letterSpacing:-0.5, color:C.ink }}>
          Filters
        </span>
        <button onClick={clearAll} style={{ marginLeft:'auto', height:34, padding:'0 14px',
          border:'none', borderRadius:11, background:'transparent', fontSize:15,
          fontWeight:700, color: count > 0 ? C.primary : C.subtle,
          cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
          Clear all
        </button>
      </div>

      {/* ── Sections ───────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', padding:'6px 18px 120px' }}>
        {SECTIONS.map((sec, si) => {
          const isOpen = !!open[sec.id];
          return (
            <div key={sec.id} style={{ marginTop:22 }}>
              {/* Section header */}
              <button onClick={() => toggleSection(sec.id)} style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                width:'100%', border:'none', background:'none', padding:0,
                cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ fontSize:20, fontWeight:800, letterSpacing:-0.3, color:C.ink }}>
                    {sec.title}
                  </span>
                  {/* Active count badge for this section */}
                  {sec.opts.filter(o => selected[`${sec.id}:${o}`]).length > 0 && (
                    <span style={{ display:'inline-flex', alignItems:'center',
                                   justifyContent:'center', minWidth:20, height:20,
                                   padding:'0 6px', borderRadius:999,
                                   background:C.primary, color:'#fff',
                                   fontSize:12, fontWeight:800 }}>
                      {sec.opts.filter(o => selected[`${sec.id}:${o}`]).length}
                    </span>
                  )}
                </div>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                  style={{ transition:'transform .2s', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', flexShrink:0 }}>
                  <path d="M6 9l6 6 6-6" stroke={C.muted} strokeWidth="2.2"
                        strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* Chips */}
              {isOpen && (
                <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginTop:13 }}>
                  {sec.opts.map(opt => {
                    const key = `${sec.id}:${opt}`;
                    const on  = !!selected[key];
                    return (
                      <button key={opt} onClick={() => toggleChip(key)} style={{
                        flexShrink:0, height:42, padding:'0 18px', borderRadius:999,
                        fontSize:15, fontWeight:700, cursor:'pointer',
                        fontFamily:"'Montserrat',-apple-system,sans-serif",
                        border: on ? 'none' : `1.5px solid #D8DCE5`,
                        background: on ? C.primary : '#fff',
                        color: on ? '#fff' : '#3B4452',
                        boxShadow: on ? '0 4px 12px rgba(2,162,240,0.28)' : 'none',
                        transition:'all .15s',
                      }}>
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Divider between sections */}
              {si < SECTIONS.length - 1 && (
                <div style={{ height:1, background:'rgba(16,24,40,0.07)', marginTop:20 }}/>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Sticky Apply bar ───────────────────────────────── */}
      <div style={{ position:'absolute', bottom:0, left:0, right:0, zIndex:6,
                    background:'linear-gradient(180deg,rgba(238,241,246,0) 0%,#EEF1F6 26%)',
                    padding:'16px 18px 28px' }}>
        {count > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12 }}>
            {Object.keys(selected).map(key => {
              const [, opt] = key.split(':');
              return (
                <span key={key} onClick={() => toggleChip(key)} style={{
                  display:'inline-flex', alignItems:'center', gap:5, height:28,
                  padding:'0 10px', borderRadius:999, background:C.primary,
                  color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer',
                }}>
                  {opt}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                    <path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"/>
                  </svg>
                </span>
              );
            })}
          </div>
        )}
        <button onClick={() => {
          if (count === 0) { showToast('Select at least one filter'); return; }
          if (applyFilters) applyFilters(selected);
          showToast(`${count} filter${count > 1 ? 's' : ''} applied to ${fromLabel}`);
          goBack();
        }} style={{
          width:'100%', height:56, border:'none', borderRadius:18, cursor:'pointer',
          background: count > 0 ? 'linear-gradient(135deg,#19BFFF,#008FF0)' : '#C5CBD6',
          color:'#fff', fontSize:17, fontWeight:800,
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          display:'flex', alignItems:'center', justifyContent:'center', gap:10,
          boxShadow: count > 0 ? '0 10px 24px rgba(2,162,240,0.42)' : 'none',
          transition:'all .2s',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="2"/>
            <path d="m8 12 2.5 2.5L16 9" stroke="#fff" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {applyLabel}
        </button>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// POST CARD (extracts useComments per post)
// ─────────────────────────────────────────────────────────────
function PostCard({ p, postLiked, togglePostLike, currentUser, showToast, navigate, isGroupAdmin, deletePost, togglePinPost }) {
  const pid = p.id;
  const liked = !!postLiked[pid];
  const { comments, addComment, likeComment } = useComments(pid);
  const [cOpen, setCOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [likedComments, setLikedComments] = useState({});
  const [showOptions, setShowOptions] = useState(false);
  const [commentSearchOpen, setCommentSearchOpen] = useState(false);
  const [commentQuery, setCommentQuery] = useState('');
  const [commentSort, setCommentSort] = useState('top'); // 'top' | 'newest'
  const [expandedReplies, setExpandedReplies] = useState({});
  const inputRef = useRef(null);

  const isOwner = !!(currentUser?.userId && p.user_id === currentUser.userId);
  const canModerate = isOwner || isGroupAdmin;

  const handleDeletePost = async () => {
    setShowOptions(false);
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    if (!deletePost) { showToast('Post actions are unavailable right now'); return; }
    const { error } = await deletePost(pid);
    showToast(error ? 'Could not delete post: ' + error.message : 'Post deleted');
  };

  const handleTogglePin = async () => {
    setShowOptions(false);
    if (!togglePinPost) { showToast('Post actions are unavailable right now'); return; }
    const { error } = await togglePinPost(pid, !p.is_pinned);
    showToast(error ? 'Could not update post: ' + error.message : (p.is_pinned ? 'Post unpinned' : 'Post pinned to top'));
  };

  const startReply = (c) => {
    setReplyTo({ id: c.id, author: c.author });
    setDraft(`@${c.author} `);
    setCOpen(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleLikeComment = (cid) => {
    if (likedComments[cid]) return;
    setLikedComments(prev => ({ ...prev, [cid]: true }));
    likeComment(cid);
  };

  // Poll state
  const pollOptions = p.poll_options || null;
  const [pollVotes, setPollVotes]     = useState(p.poll_votes || {});
  const [myVote,    setMyVote]        = useState(() => {
    const voters = p.poll_voter_ids || [];
    if (!currentUser?.userId) return null;
    const idx = voters.findIndex(v => typeof v === 'object' ? v.uid === currentUser.userId : v === currentUser.userId);
    if (idx === -1) return null;
    const voter = voters[idx];
    return typeof voter === 'object' ? voter.opt : null;
  });

  const pollExpired = !!p.poll_expires_at && new Date(p.poll_expires_at).getTime() < Date.now();

  const castVote = async (optIdx) => {
    if (!currentUser?.userId) { showToast('Sign in to vote'); return; }
    if (myVote !== null) { showToast('You already voted'); return; }
    if (pollExpired) { showToast('This poll has closed'); return; }
    const newVotes = { ...pollVotes, [optIdx]: ((pollVotes[optIdx] || 0) + 1) };
    setPollVotes(newVotes);
    setMyVote(optIdx);
    // Cast via RPC: posts.update() is owner-only now, so voting (a non-owner
    // write) goes through a security-definer function that only ever touches
    // poll_votes/poll_voter_ids and enforces one vote per user server-side.
    const { error } = await supabase.rpc('cast_post_vote', { p_post_id: pid, p_opt_idx: optIdx });
    if (error) console.error('[castVote] error:', error);
  };

  const submitComment = async () => {
    const t = draft.trim();
    if (!t) return;
    const rt = replyTo;
    setDraft('');
    setReplyTo(null);
    await addComment(t, currentUser, rt);
  };

  // Group-announcement posts (e.g. "New Event Alert") always show the
  // group's own identity, even when the viewer is the member who created the
  // underlying event -- so skip the "it's me" live-profile override for those.
  const isMe = !p.author_is_group && !!(currentUser?.userId && p.user_id === currentUser.userId);

  return (
    <div style={{ background:'#fff', borderRadius:18, boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:15 }}>
      {/* Author */}
      <div style={{ display:'flex', alignItems:'center', gap:11 }}>
        {(() => {
          const avatarUrl = isMe ? currentUser.avatarUrl : (p.avatar_url || null);
          const avatarColor = isMe ? (currentUser.avatarColor || p.aColor) : p.aColor;
          const initial = isMe ? (currentUser.name?.[0] || p.aInitial) : p.aInitial;
          return (
            <div style={{ width:40, height:40, borderRadius:'50%', flexShrink:0,
                          background: avatarUrl ? 'transparent' : avatarColor,
                          display:'flex', alignItems:'center', justifyContent:'center', color:'#fff',
                          fontSize:16, fontWeight:800, position:'relative', overflow:'hidden' }}>
              {avatarUrl
                ? <img src={avatarUrl} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
                : <><span>{initial}</span>
                    <div style={{ position:'absolute', inset:0, background:'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 10px)'}}/></>
              }
            </div>
          );
        })()}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
            <span style={{ fontSize:16, fontWeight:800, color:C.ink }}>
              {isMe ? (currentUser.name || p.author) : p.author}
            </span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M12 2.5l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.6.6 2.6-2.3 1.4-1 2.5-2.7-.2L12 21.5 9.8 19.9l-2.7.2-1-2.5-2.3-1.4.6-2.6L3.8 11l2.3-1.4 1-2.5 2.7.2L12 2.5Z" fill="#02B6FE"/>
              <path d="m9 12 2 2 4-4.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ fontSize:13.5, color:C.subtle, marginTop:1 }}>{p.time}</div>
        </div>
        {p.is_pinned && (
          <div style={{ display:'flex', alignItems:'center', gap:4, marginRight:6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <g transform="rotate(45 12 12)">
                <line x1="12" y1="17" x2="12" y2="22" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round"/>
                <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
              </g>
            </svg>
            <span style={{ fontSize:12.5, fontWeight:800, color:C.primary }}>Pinned</span>
          </div>
        )}
        <button onClick={() => setShowOptions(true)} style={{ width:30, height:30, border:'none', background:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="5"  cy="12" r="1.7" fill={C.subtle}/>
            <circle cx="12" cy="12" r="1.7" fill={C.subtle}/>
            <circle cx="19" cy="12" r="1.7" fill={C.subtle}/>
          </svg>
        </button>
      </div>

      {/* Post text */}
      <div style={{ fontSize:16, fontWeight:600, color:C.ink, marginTop:12, lineHeight:1.5 }}><Linkify text={p.text} /></div>

      {/* Poll */}
      {pollOptions && pollOptions.length >= 2 && (() => {
        const totalVotes = Object.values(pollVotes).reduce((s, n) => s + n, 0);
        const daysLeft = p.poll_expires_at
          ? Math.max(0, Math.ceil((new Date(p.poll_expires_at).getTime() - Date.now()) / 86400000))
          : null;
        return (
          <div style={{ marginTop:14, display:'flex', flexDirection:'column', gap:9 }}>
            {pollOptions.map((opt, i) => {
              const count  = pollVotes[i] || 0;
              const pct    = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
              const isMyV  = myVote === i;
              const voted  = myVote !== null || pollExpired;
              return (
                <button key={i} onClick={() => castVote(i)} disabled={voted}
                  style={{ position:'relative', width:'100%', textAlign:'left', border:'none',
                           borderRadius:12, overflow:'hidden', padding:0, cursor: voted ? 'default' : 'pointer',
                           background:'transparent' }}>
                  {/* progress bar bg */}
                  <div style={{ position:'absolute', inset:0, borderRadius:12,
                                background: isMyV
                                  ? 'rgba(0,152,240,0.12)'
                                  : voted ? '#F3F4F8' : '#F3F4F8' }}/>
                  {/* filled portion */}
                  {voted && (
                    <div style={{ position:'absolute', top:0, left:0, bottom:0, borderRadius:12,
                                  width:`${pct}%`, transition:'width 0.5s ease',
                                  background: isMyV
                                    ? C.grad
                                    : 'rgba(0,152,240,0.10)' }}/>
                  )}
                  {/* content */}
                  <div style={{ position:'relative', display:'flex', alignItems:'center',
                                justifyContent:'space-between', padding:'11px 14px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      {/* radio circle */}
                      <div style={{ width:18, height:18, borderRadius:'50%', flexShrink:0,
                                    border: isMyV ? 'none' : `2px solid ${voted ? '#CBD0DC' : C.primary}`,
                                    background: isMyV ? C.grad : 'transparent',
                                    display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {isMyV && <div style={{ width:7, height:7, borderRadius:'50%', background:'#fff' }}/>}
                      </div>
                      <span style={{ fontSize:15.5, fontWeight: isMyV ? 800 : 600,
                                     fontFamily:"'Montserrat',-apple-system,sans-serif",
                                     color: isMyV ? '#fff' : C.ink }}>{opt}</span>
                    </div>
                    {voted && (
                      <span style={{ fontSize:14, fontWeight:700, fontFamily:"'Montserrat',-apple-system,sans-serif", color: isMyV ? '#fff' : C.subtle }}>
                        {pct}%
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
            <div style={{ fontSize:13, color:C.subtle, marginTop:2, textAlign:'center', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
              {totalVotes} vote{totalVotes !== 1 ? 's' : ''}
              {pollExpired ? ' · Poll closed'
                : daysLeft !== null ? ` · ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`
                : ''}
              {!pollExpired && myVote === null ? ' · Tap to vote' : ''}
            </div>
          </div>
        );
      })()}

      {/* Image(s) — multiple photos scroll horizontally, a single photo fills the width */}
      {Array.isArray(p.images) && p.images.length > 1 ? (
        <div data-hscroll="true" style={{ display:'flex', gap:8, overflowX:'auto', marginTop:11, paddingBottom:2 }}>
          {p.images.map((url, i) => (
            <div key={i} style={{ borderRadius:14, overflow:'hidden', flexShrink:0, width:220, height:220 }}>
              <img src={url} alt="" style={{ width:'100%', height:'100%', display:'block', objectFit:'cover' }} />
            </div>
          ))}
        </div>
      ) : p.image_url && (
        <div style={{ borderRadius:14, overflow:'hidden', marginTop:11, aspectRatio:'4 / 3' }}>
          <img src={p.image_url} alt="" style={{ width:'100%', height:'100%', display:'block', objectFit:'cover' }} />
        </div>
      )}

      {/* File attachment */}
      {p.file_url && (
        <a href={p.file_url} target="_blank" rel="noopener noreferrer" download={p.file_name || true}
          style={{ display:'flex', alignItems:'center', gap:11, marginTop:11,
                   background:'rgba(0,152,240,0.07)', borderRadius:14, padding:'11px 14px',
                   textDecoration:'none', border:`1.5px solid rgba(0,152,240,0.18)` }}>
          {/* file icon */}
          <div style={{ width:38, height:38, borderRadius:10, flexShrink:0,
                        background:C.grad,
                        display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round"/>
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:15, fontWeight:700, color:C.ink,
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {p.file_name || 'Attachment'}
            </div>
            <div style={{ fontSize:13, color:C.subtle, marginTop:2 }}>Tap to download</div>
          </div>
          {/* download arrow */}
          <div style={{ width:32, height:32, borderRadius:999, background:'#fff',
                        display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                        boxShadow:`0 2px 8px rgba(0,152,240,0.15)` }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M12 4v12M8 13l4 4 4-4M4 20h16" stroke={C.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </a>
      )}

      {/* Linked event chip */}
      {p.linked_event_title && (
        <button onClick={() => p.linked_event_id ? navigate?.('event-details', { eventId: p.linked_event_id }) : showToast('Event unavailable')}
          style={{ display:'flex', alignItems:'center', gap:10, marginTop:10, width:'100%',
                   background:'rgba(2,162,240,0.08)', border:'none', borderRadius:12, padding:'10px 12px', cursor:'pointer' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
            <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke={C.primary} strokeWidth="1.9"/>
            <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round"/>
          </svg>
          <div style={{ flex:1, minWidth:0, textAlign:'left' }}>
            <div style={{ fontSize:14.5, fontWeight:800, color:C.primary, fontFamily:"'Montserrat',-apple-system,sans-serif", overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {p.linked_event_title}
            </div>
            {(p.linked_event_date || p.linked_event_time) && (
              <div style={{ fontSize:13, fontWeight:600, color:C.subtle, fontFamily:"'Montserrat',-apple-system,sans-serif", marginTop:2 }}>
                {[p.linked_event_date, p.linked_event_time].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
            <path d="M9 6l6 6-6 6" stroke={C.subtle} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}

      {/* Like / Comment / Share */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:13 }}>
        <button onClick={() => togglePostLike(pid)}
          style={{ display:'flex', alignItems:'center', gap:6, border:'none', background:'none', cursor:'pointer', padding:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"
                  fill={liked?'#FF3B6B':'none'} stroke={liked?'#FF3B6B':C.subtle} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize:15, fontWeight:700, color:liked?'#FF3B6B':'#7B8499' }}>{(p.likes||0)+(liked?1:0)}</span>
        </button>
        <button onClick={() => { setCOpen(o=>!o); setTimeout(()=>inputRef.current?.focus(),100); }}
          style={{ display:'flex', alignItems:'center', gap:6, border:'none', background:'none', cursor:'pointer', padding:0, marginLeft:14 }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"
                  stroke={cOpen?C.primary:C.subtle} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize:15, fontWeight:700, color:'#7B8499' }}>{comments.length}</span>
        </button>
        <button onClick={async () => {
            const shareText = p.text || 'Check this post on Riply';
            if (navigator.share) {
              try { await navigator.share({ title: 'Riply post', text: shareText, url: window.location.href }); return; } catch {}
            }
            try { await navigator.clipboard.writeText(shareText); showToast('Copied to clipboard'); } catch { showToast('Post shared'); }
          }}
          style={{ display:'flex', alignItems:'center', gap:6, border:'none', background:'none', cursor:'pointer', padding:0, marginLeft:'auto' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <circle cx="18" cy="5" r="2.6" stroke={C.subtle} strokeWidth="1.9"/>
            <circle cx="6" cy="12" r="2.6" stroke={C.subtle} strokeWidth="1.9"/>
            <circle cx="18" cy="19" r="2.6" stroke={C.subtle} strokeWidth="1.9"/>
            <path d="m8.3 10.7 7.4-4.3M8.3 13.3l7.4 4.3" stroke={C.subtle} strokeWidth="1.9" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Comments popup — opens as a bottom sheet over the page when the
          comment icon is tapped, rather than expanding inline in the feed. */}
      {cOpen && (() => {
        const q = commentQuery.trim().toLowerCase();
        const topLevel = comments.filter(c => !c.replyToId);
        const repliesByParent = {};
        comments.filter(c => c.replyToId).forEach(c => {
          (repliesByParent[c.replyToId] ||= []).push(c);
        });
        const matches = (c) => !q || c.author?.toLowerCase().includes(q) || c.text?.toLowerCase().includes(q);
        const visible = topLevel
          .filter(c => matches(c) || (repliesByParent[c.id] || []).some(matches))
          .slice()
          .sort((a, b) => commentSort === 'top'
            ? ((b.likes || 0) - (a.likes || 0))
            : (new Date(b.created_at || 0) - new Date(a.created_at || 0)));

        const CommentRow = ({ c, isReply }) => {
          const isLiked = !!likedComments[c.id];
          const likeCount = (c.likes || 0) + (isLiked ? 1 : 0);
          const replies = repliesByParent[c.id] || [];
          const expanded = !!expandedReplies[c.id];
          return (
            <div style={{ marginBottom:16 }}>
              <div style={{ display:'flex', gap:10 }}>
                <div style={{ width:34, height:34, borderRadius:'50%', flexShrink:0, background:c.aColor,
                              display:'flex', alignItems:'center', justifyContent:'center',
                              color:'#fff', fontSize:14, fontWeight:800 }}>{c.aInitial}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
                    <span style={{ fontSize:15.5, fontWeight:800, color:C.ink }}>{c.author}</span>
                    <span style={{ fontSize:13, color:C.subtle }}>{c.time}</span>
                  </div>
                  {c.replyToName && (
                    <div style={{ fontSize:12.5, color:C.primary, fontWeight:700, marginTop:2 }}>↩ {c.replyToName}</div>
                  )}
                  <div style={{ fontSize:15.5, color:C.body, marginTop:3, lineHeight:1.4 }}><Linkify text={c.text} /></div>
                  <div style={{ display:'flex', alignItems:'center', gap:16, marginTop:7 }}>
                    <button onClick={() => handleLikeComment(c.id)}
                      style={{ display:'flex', alignItems:'center', gap:5, border:'none', background:'none', cursor:'pointer', padding:0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7C20.5 15 12 20.5 12 20.5Z"
                              fill={isLiked?'#FF3B6B':'none'} stroke={isLiked?'#FF3B6B':C.subtle} strokeWidth="1.8" strokeLinejoin="round"/>
                      </svg>
                      <span style={{ fontSize:14, fontWeight:700, color: isLiked?'#FF3B6B':C.subtle }}>{likeCount}</span>
                    </button>
                    {!isReply && (
                      <button onClick={() => setExpandedReplies(s => ({ ...s, [c.id]: !s[c.id] }))}
                        disabled={replies.length === 0}
                        style={{ display:'flex', alignItems:'center', gap:5, border:'none', background:'none',
                                 cursor: replies.length ? 'pointer' : 'default', padding:0,
                                 opacity: replies.length ? 1 : 0.4 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" stroke={C.subtle} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span style={{ fontSize:14, fontWeight:700, color:C.subtle }}>{replies.length}</span>
                      </button>
                    )}
                    <button onClick={() => startReply(c)}
                      style={{ display:'flex', alignItems:'center', gap:5, border:'none', cursor:'pointer',
                               padding:'3px 10px', borderRadius:999, background:C.chip }}>
                      <span style={{ fontSize:13.5, fontWeight:700, color:C.body }}>reply</span>
                    </button>
                    {!isReply && replies.length > 0 && (
                      <button onClick={() => setExpandedReplies(s => ({ ...s, [c.id]: !s[c.id] }))}
                        style={{ marginLeft:'auto', border:'none', background:'none', cursor:'pointer', padding:0,
                                 display:'flex', alignItems:'center' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                          style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition:'transform .15s' }}>
                          <path d="m6 9 6 6 6-6" stroke={C.subtle} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {!isReply && expanded && replies.map(r => (
                <div key={r.id} style={{ marginLeft:44, marginTop:12 }}>
                  <CommentRow c={r} isReply />
                </div>
              ))}
            </div>
          );
        };

        return (
          <div onClick={() => setCOpen(false)} style={{
            position:'fixed', inset:0, zIndex:55,
            background:'rgba(14,23,38,0.45)', display:'flex', alignItems:'flex-end',
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              width:'100%', maxHeight:'82vh', display:'flex', flexDirection:'column',
              background:'#fff', borderRadius:'24px 24px 0 0',
              fontFamily:"'Montserrat',-apple-system,sans-serif",
            }}>
              <div style={{ width:38, height:4, borderRadius:99, background:'#D1D8E4', margin:'10px auto 0', flexShrink:0 }}/>
              {/* Header */}
              <div style={{ flexShrink:0, display:'flex', alignItems:'center', gap:8, padding:'14px 16px 12px' }}>
                <span style={{ flex:1, fontSize:20, fontWeight:800, letterSpacing:-0.3, color:C.ink }}>Top comments</span>
                <button onClick={() => setCommentSearchOpen(v => !v)} aria-label="Search comments" style={{
                  width:36, height:36, border:'none', borderRadius:'50%', background: commentSearchOpen ? C.grad : C.chip,
                  display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke={commentSearchOpen?'#fff':'#39414F'} strokeWidth="2"/><path d="m20 20-3.2-3.2" stroke={commentSearchOpen?'#fff':'#39414F'} strokeWidth="2" strokeLinecap="round"/></svg>
                </button>
                <button onClick={() => setCommentSort(s => s === 'top' ? 'newest' : 'top')} aria-label="Sort comments" style={{
                  width:36, height:36, border:'none', borderRadius:'50%', background:C.chip,
                  display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M7 12h10M10 17h4" stroke="#39414F" strokeWidth="2" strokeLinecap="round"/></svg>
                </button>
                <button onClick={() => setCOpen(false)} aria-label="Close comments" style={{
                  width:36, height:36, border:'none', borderRadius:'50%', background:C.chip,
                  display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#39414F" strokeWidth="2" strokeLinecap="round"/></svg>
                </button>
              </div>
              {commentSearchOpen && (
                <div style={{ flexShrink:0, padding:'0 16px 12px' }}>
                  <input autoFocus value={commentQuery} onChange={e => setCommentQuery(e.target.value)}
                    placeholder="Search comments…"
                    style={{ width:'100%', boxSizing:'border-box', height:38, border:`1.5px solid ${C.border}`,
                             borderRadius:999, background:C.chip, padding:'0 14px', fontSize:14.5, outline:'none',
                             fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
                </div>
              )}
              <div style={{ height:1, background:C.divider, flexShrink:0 }}/>

              {/* List */}
              <div style={{ flex:1, overflowY:'auto', padding:'14px 16px' }}>
                {comments.length === 0 && (
                  <div style={{ fontSize:14.5, color:C.subtle, textAlign:'center', padding:'24px 0' }}>No comments yet. Be the first!</div>
                )}
                {comments.length > 0 && visible.length === 0 && (
                  <div style={{ fontSize:14.5, color:C.subtle, textAlign:'center', padding:'24px 0' }}>No comments match "{commentQuery.trim()}"</div>
                )}
                {visible.map(c => <CommentRow key={c.id} c={c} isReply={false} />)}
              </div>

              {/* Reply indicator */}
              {replyTo && (
                <div style={{ flexShrink:0, display:'flex', alignItems:'center', gap:6, background:'rgba(0,152,240,0.07)',
                              margin:'0 16px', borderRadius:8, padding:'5px 10px' }}>
                  <span style={{ fontSize:13, color:C.primary, fontWeight:600 }}>↩ Replying to {replyTo.author}</span>
                  <button onClick={() => { setReplyTo(null); setDraft(''); }}
                    style={{ border:'none', background:'none', cursor:'pointer', padding:0, marginLeft:'auto',
                             fontSize:14, color:C.subtle, lineHeight:1 }}>✕</button>
                </div>
              )}

              {/* Input */}
              <div style={{ flexShrink:0, display:'flex', gap:8, alignItems:'center', padding:'10px 16px calc(14px + env(safe-area-inset-bottom))', borderTop:`1px solid ${C.divider}` }}>
                <div style={{ width:32, height:32, borderRadius:'50%', flexShrink:0,
                              background:currentUser?.avatarUrl ? 'none' : (currentUser?.avatarColor || C.grad),
                              display:'flex', alignItems:'center', justifyContent:'center',
                              color:'#fff', fontSize:14, fontWeight:800, overflow:'hidden' }}>
                  {currentUser?.avatarUrl
                    ? <img src={currentUser.avatarUrl} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
                    : (currentUser?.name?.[0] || 'Y').toUpperCase()}
                </div>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitComment(); } }}
                  placeholder={replyTo ? `Reply to ${replyTo.author}…` : 'Write a comment…'}
                  style={{ flex:1, height:38, border:`1.5px solid ${C.border}`, borderRadius:999,
                           background:'#fff', padding:'0 13px', fontSize:14.5, outline:'none',
                           fontFamily:"'Montserrat',-apple-system,sans-serif" }}
                />
                {draft.trim() && (
                  <button onClick={submitComment} style={{ width:38, height:38, border:'none', borderRadius:'50%',
                    background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Post options sheet */}
      {showOptions && (
        <div onClick={() => setShowOptions(false)} style={{
          position:'fixed', inset:0, zIndex:50,
          background:'rgba(14,23,38,0.45)', display:'flex', alignItems:'flex-end',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width:'100%', background:'#fff', borderRadius:'22px 22px 0 0',
            padding:'10px 0 40px', fontFamily:"'Montserrat',-apple-system,sans-serif",
          }}>
            <div style={{ width:38, height:4, borderRadius:99, background:'#D1D8E4', margin:'0 auto 18px' }}/>
            {[
              ...(isGroupAdmin ? [{
                label: p.is_pinned ? 'Unpin Post' : 'Pin Post',
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><g transform="rotate(45 12 12)"><line x1="12" y1="17" x2="12" y2="22" stroke={C.body} strokeWidth="1.9" strokeLinecap="round"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" stroke={C.body} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></g></svg>,
                action: handleTogglePin,
              }] : []),
              ...(canModerate ? [{
                label: 'Delete Post', danger: true,
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7m2 0-.8 12.1a2 2 0 0 1-2 1.9H8.8a2 2 0 0 1-2-1.9L6 7" stroke="#C2493D" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>,
                action: handleDeletePost,
              }] : []),
              { label:'Report Post', danger:true,
                icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01" stroke="#C2493D" strokeWidth="2" strokeLinecap="round"/><path d="M10.3 3.5 2 20h20L13.7 3.5a2 2 0 0 0-3.4 0Z" stroke="#C2493D" strokeWidth="1.9" strokeLinejoin="round"/></svg>,
                action: async () => {
                  setShowOptions(false);
                  if (!currentUser?.userId) { showToast('Sign in to report posts'); return; }
                  const reason = window.prompt('Why are you reporting this post? (optional)') || 'Reported by user';
                  const { error } = await supabase.from('post_reports').insert({
                    post_id: pid, group_id: p.group_id, reporter_id: currentUser.userId, reason,
                  });
                  showToast(error ? 'Could not submit report' : 'Report submitted');
                } },
            ].map((opt, i) => (
              <button key={i} onClick={opt.action} style={{
                width:'100%', display:'flex', alignItems:'center', gap:15,
                padding:'15px 20px', border:'none', background:'none', cursor:'pointer',
                fontFamily:"'Montserrat',-apple-system,sans-serif",
                borderTop:`1px solid ${C.divider}`,
              }}>
                {opt.icon}
                <span style={{ fontSize:16, fontWeight:700, color: opt.danger ? '#C2493D' : C.ink }}>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: GROUP PROFILE  (public & private)
// ─────────────────────────────────────────────────────────────
function GroupProfileScreen({ groupId, postLiked, togglePostLike, goBack, navigate, showToast, currentUser, markGroupRead }) {
  // Opening a group's feed counts as seeing its posts, so the group
  // activity row in Notifications stops counting them as missed.
  useEffect(() => { markGroupRead?.(groupId); }, [groupId, markGroupRead]);

  const { user, isLoaded: userLoaded } = useUser();
  const staticG = GROUPS.find(gr => gr.id === groupId) || GROUPS[0];
  const [dbGroup,     setDbGroup]     = useState(null);
  const [groupEvents, setGroupEvents] = useState([]);
  const [showOptionsSheet, setShowOptionsSheet] = useState(false);
  const [isGroupAdmin, setIsGroupAdmin] = useState(false);
  const [membershipChecked, setMembershipChecked] = useState(false);
  // Live counts from DB (source of truth, not static fallback)
  const [liveMembers, setLiveMembers] = useState(null);
  const [livePosts2,  setLivePosts2]  = useState(null);
  const [liveEvents2, setLiveEvents2] = useState(null);

  // Counts only active members — pending join requests shouldn't inflate the total.
  // Accepts an optional staleness check so callers loading a fresh group can
  // discard responses that resolve after the user has moved on again.
  const refreshCounts = (isStale = () => false) => {
    supabase.from('group_members').select('*', { count:'exact', head:true })
      .eq('group_id', groupId).in('role', ['member', 'admin', 'owner'])
      .then(({ count }) => { if (!isStale()) setLiveMembers(count ?? 0); });
    supabase.from('posts').select('*', { count:'exact', head:true }).eq('group_id', groupId)
      .then(({ count }) => { if (!isStale()) setLivePosts2(count ?? 0); });
    supabase.from('events').select('*', { count:'exact', head:true }).eq('group_id', groupId)
      .or('status.is.null,status.eq.published')
      .then(({ count }) => { if (!isStale()) setLiveEvents2(count ?? 0); });
  };

  // Bumped on every groupId/user change so in-flight requests from a previous
  // group/user can't overwrite state after the effect has moved on.
  const loadGenRef = useRef(0);

  useEffect(() => {
    if (!groupId) return;
    const gen = ++loadGenRef.current;
    const isStale = () => gen !== loadGenRef.current;

    // Reset all group-scoped state up front so stale values from the previous
    // group can't linger while the new lookup is in flight.
    setDbGroup(null);
    setMembershipChecked(false);
    setIsGroupAdmin(false);
    setJoinState(staticG.state || 'join');
    setGroupEvents([]);
    setLiveMembers(null);
    setLivePosts2(null);
    setLiveEvents2(null);

    refreshCounts(isStale);
    supabase.from('events').select('*').eq('group_id', groupId)
      .or('status.is.null,status.eq.published')
      .order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => { if (!isStale()) setGroupEvents(data || []); });

    (async () => {
      const { data: freshGroup } = await supabase.from('groups').select('*').eq('id', groupId).maybeSingle();
      if (isStale()) return;
      if (freshGroup) setDbGroup(freshGroup);

      // Wait for Clerk to finish loading before deciding there's no user —
      // otherwise a momentarily-null user during auth load gets treated as
      // "signed out" and the row unlocks with default state too early.
      if (!userLoaded) return;
      if (!user?.id) { setMembershipChecked(true); return; }

      const { data } = await supabase.from('group_members').select('role, status').eq('group_id', groupId).eq('user_id', user.id).maybeSingle();
      if (isStale()) return;
      if (data?.status === 'banned') {
        setJoinState('banned');
        setIsGroupAdmin(false);
      } else if (data) {
        setJoinState(data.role === 'pending' ? 'requested' : 'joined');
        setIsGroupAdmin(data.role === 'admin' || data.role === 'owner');
      } else {
        setIsGroupAdmin(false);
        // Fail closed: if we couldn't confirm the group's real privacy (fetch
        // failed/lagged), require a request instead of defaulting to instant join.
        setJoinState(freshGroup ? (freshGroup.privacy === 'private' ? 'request' : 'join') : 'request');
      }
      setMembershipChecked(true);
    })();
  }, [groupId, user?.id, userLoaded]);
  const g = dbGroup || staticG;
  const { posts: livePosts, loading: postsLoading, deletePost, togglePinPost } = usePosts(groupId);


  const [joinState,  setJoinState]  = useState(staticG.state || "join");
  const [notifyOn,   setNotifyOn]   = useState((staticG.state || "join") === 'joined');
  const GROUP_TABS = ['posts', 'events', 'media', 'rules'];
  const [activeTab,  setActiveTab]  = useState('posts');
  // Continuous scroll-driven collapse — the header scrubs in lockstep with
  // scrollTop instead of snapping at a threshold, so content never slides
  // out from under it.
  const COLLAPSE_DISTANCE = 90;
  const [scrollY, setScrollY] = useState(0);
  const coverProgress = Math.min(1, Math.max(0, scrollY / COLLAPSE_DISTANCE));
  const lerp = (a, b) => a + (b - a) * coverProgress;
  // The big avatar has to be fully gone before scrolling content reaches its
  // fixed position, so it fades/shrinks on a much faster curve than the bar.
  const avatarProgress = Math.min(1, coverProgress / 0.22);
  const avatarLerp = (a, b) => a + (b - a) * avatarProgress;

  // Throttle to one state update per animation frame — native scroll events
  // can fire far more often than the screen can paint, and each update
  // re-renders this whole screen (post list included). Reads the latest
  // scrollTop at paint time, not whichever event happened to schedule the frame.
  const latestScrollTopRef = useRef(0);
  const scrollRafRef = useRef(null);
  const handleGroupScroll = (e) => {
    latestScrollTopRef.current = e.currentTarget.scrollTop;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      setScrollY(latestScrollTopRef.current);
    });
  };
  useEffect(() => () => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  // Swipe between group tabs
  const swipeTouchStart = useRef(null);
  const handleTabTouchStart = (e) => {
    // Don't arm the tab-swipe gesture if the touch starts inside a
    // horizontally-scrollable element (e.g. a post's multi-photo strip) --
    // otherwise scrolling through photos also drags the tab underneath it.
    if (e.target.closest?.('[data-hscroll]')) { swipeTouchStart.current = null; return; }
    swipeTouchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const handleTabTouchEnd = (e) => {
    if (!swipeTouchStart.current) return;
    const dx = e.changedTouches[0].clientX - swipeTouchStart.current.x;
    const dy = e.changedTouches[0].clientY - swipeTouchStart.current.y;
    swipeTouchStart.current = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    setActiveTab(prev => {
      const i = GROUP_TABS.indexOf(prev);
      const next = dx < 0 ? Math.min(i + 1, GROUP_TABS.length - 1) : Math.max(i - 1, 0);
      return GROUP_TABS[next];
    });
  };

  const [postText,   setPostText]   = useState('');
  const [posting,    setPosting]    = useState(false);

  const isPrivate    = joinState === 'request' || joinState === 'requested';
  const isJoined     = joinState === 'joined';
  const isRequested  = joinState === 'requested';
  const canSee       = isJoined || (g.state || "join") === 'joined';
  const mediaImages  = useMemo(() => livePosts.filter(p => p.image_url), [livePosts]);

  // Guards against a rapid second click launching the opposite mutation
  // (e.g. Join immediately followed by Leave) while the first is in flight.
  const [membershipMutating, setMembershipMutating] = useState(false);

  const handlePrimary = async () => {
    if (!user?.id) { showToast('Sign in to join groups'); return; }
    if (joinState === 'banned') { showToast("You've been banned from this group"); return; }
    if (membershipMutating) return;
    setMembershipMutating(true);
    try {
      if (joinState === 'join') {
        setJoinState('joined');
        const { error } = await supabase.from('group_members').upsert({ group_id: groupId, user_id: user.id, role: 'member' });
        if (error) { setJoinState('join'); showToast('Failed to join: ' + error.message); return; }
        refreshCounts();
      } else if (joinState === 'joined') {
        setJoinState('join');
        const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', user.id);
        if (error) { setJoinState('joined'); showToast('Failed to leave: ' + error.message); return; }
        refreshCounts();
      } else if (joinState === 'request') {
        setJoinState('requested');
        const { error: joinErr } = await supabase.from('group_members').upsert({ group_id: groupId, user_id: user.id, role: 'pending' });
        if (joinErr) { setJoinState('request'); showToast('Failed to send request: ' + joinErr.message); return; }

        const { error: notifErr } = await supabase.from('notifications').insert({
          user_id: user.id,
          type: 'group',
          title: 'Request sent',
          body: `Your request to join ${g.name} is pending approval.`,
        });
        if (notifErr) console.error('Request-sent notification failed:', notifErr);

        const { data: admins, error: adminsErr } = await supabase.from('group_members').select('user_id')
          .eq('group_id', groupId).in('role', ['admin', 'owner']);
        if (adminsErr) console.error('Admin lookup for join-request notification failed:', adminsErr);
        const requesterName = currentUser?.name || 'Someone';
        const adminNotifs = (admins || [])
          .filter(a => a.user_id !== user.id)
          .map(a => ({
            user_id: a.user_id,
            type: 'group',
            title: 'New join request',
            body: `${requesterName} wants to join ${g.name}.`,
          }));
        if (adminNotifs.length) {
          const { error: fanoutErr } = await supabase.from('notifications').insert(adminNotifs);
          if (fanoutErr) console.error('Admin join-request notification fanout failed:', fanoutErr);
        }
      } else if (joinState === 'requested') {
        setJoinState('request');
        const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', user.id);
        if (error) { setJoinState('requested'); showToast('Failed to cancel request: ' + error.message); return; }
      }
    } finally {
      setMembershipMutating(false);
    }
  };

  // ── primary button spec per state ───────────────────────
  const BTN = {
    joined:    { bg:'linear-gradient(135deg,#19BFFF,#0090F0)', color:'#fff', shadow:'0 8px 20px rgba(2,162,240,0.4)',    label:'Joined',             icon:'check' },
    join:      { bg:'#0E1726',                                  color:'#fff', shadow:'0 8px 20px rgba(14,23,38,0.28)',   label:'Join Group',          icon:'plus'  },
    requested: { bg:'#fff', border:`1.6px solid ${C.border}`,  color:'#7B8499', shadow:'none',                          label:'Requested · Pending', icon:null    },
    request:   { bg:'#0E1726',                                  color:'#fff', shadow:'0 8px 20px rgba(14,23,38,0.28)',   label:'Request To Join',     icon:null    },
    banned:    { bg:'#F1F3F7',                                  color:'#7B8499', shadow:'none',                          label:'Banned',               icon:null    },
  };
  const btn = BTN[joinState] || BTN.join;

  // Admin-pinned event banner (shown between the action buttons and the
  // social links, for every visitor, regardless of tab) -- pinning itself
  // is admin-only, enforced by the pin toggle in the Events tab.
  const pinnedEvent = groupEvents.find(e => e.is_pinned) || null;

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      {/* ── Sticky collapsing bar (sits above scroll area) ── */}
      <div style={{
        position:'relative', zIndex:20,
        height: lerp(100, 52),
        flexShrink:0,
        /* allow avatar to overflow downward without clipping */
        overflow:'visible',
      }}>
        {/* Clipping wrapper for backgrounds only */}
        <div style={{ position:'absolute', inset:0, overflow:'hidden' }}>
        {/* Cover */}
        <div style={{
          position:'absolute', inset:0,
          background:'linear-gradient(135deg,#1A1F2E 0%,#2E3548 60%,#465067 120%)',
          opacity: 1 - coverProgress,
          transform: `scale(${lerp(1, 1.04)})`,
          transformOrigin:'center top',
        }}>
          {g.cover_url
            ? <img src={g.cover_url} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>
            : <div style={{ position:'absolute', inset:0, background:
                'repeating-linear-gradient(135deg,rgba(255,255,255,0.06) 0,rgba(255,255,255,0.06) 2px,transparent 2px,transparent 18px)' }}/>
          }
        </div>

        {/* Silver bar that fades in as cover fades out */}
        <div style={{
          position:'absolute', inset:0,
          background:'linear-gradient(145deg,rgba(240,242,248,0.97),rgba(220,225,238,0.97))',
          backdropFilter:'blur(24px)', WebkitBackdropFilter:'blur(24px)',
          opacity: coverProgress,
          borderBottom:`1px solid rgba(190,198,218,0.6)`,
          boxShadow:'0 2px 16px rgba(0,0,0,0.08)',
        }}/>
        </div>{/* end clipping wrapper */}

        {/* Back + menu buttons — always visible, re-center as the bar shrinks */}
        <button onClick={goBack} style={{ position:'absolute', top: lerp(50, 6), left:14, width:40,
          height:40, border:'none', borderRadius:'50%',
          background: `rgba(14,23,38,${lerp(0.5, 1)})`,
          backdropFilter:'blur(8px)',
          display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
          zIndex:21 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M14 6l-6 6 6 6" stroke='#fff' strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button onClick={() => setShowOptionsSheet(true)} style={{
          position:'absolute', top: lerp(50, 6), right:14, width:40, height:40,
          border:'none', borderRadius:'50%',
          background: `rgba(14,23,38,${lerp(0.5, 1)})`,
          backdropFilter:'blur(8px)', display:'flex', alignItems:'center',
          justifyContent:'center', cursor:'pointer', zIndex:21 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="5"  r="1.8" fill='#fff'/>
            <circle cx="12" cy="12" r="1.8" fill='#fff'/>
            <circle cx="12" cy="19" r="1.8" fill='#fff'/>
          </svg>
        </button>

        {/* Avatar + group name fill the compact bar once it's collapsed.
            Opacity/interactivity track avatarProgress (not coverProgress) so this
            row finishes fading in exactly as the big avatar finishes fading out —
            no gap where neither is visible/tappable. */}
        <div style={{
          position:'absolute', bottom:0, left:0, right:0, height:52,
          display:'flex', alignItems:'center', justifyContent:'center', gap:9,
          opacity: avatarProgress,
          transform: `translateY(${lerp(6, 0)}px) scale(${lerp(0.94, 1)})`,
          zIndex:2, pointerEvents: avatarProgress > 0.5 ? 'auto' : 'none',
        }}>
          {/* gradient ring around the mini avatar — theme blue, not the group's own color */}
          <div style={{ width:30, height:30, borderRadius:'50%', flexShrink:0, padding:2,
                        background: C.grad }}>
            <div style={{ width:'100%', height:'100%', borderRadius:'50%',
                          background: g.logoColor || g.logo_color || C.grad,
                          display:'flex', alignItems:'center', justifyContent:'center',
                          color:'#fff', fontSize:14, fontWeight:800,
                          border:'2px solid #F4F6FA', position:'relative', overflow:'hidden' }}>
              {g.avatar_url
                ? <img src={g.avatar_url} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>
                : (g.initial || (g.name || 'G')[0].toUpperCase())
              }
            </div>
          </div>
          <span style={{ fontSize:17, fontWeight:800, color:C.ink, letterSpacing:'-0.3px',
                        maxWidth:170, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {g.name || 'Group'}
          </span>
        </div>
      </div>

      {/* ── Avatar — outside scroll so it sits above the sticky header, fades away as bar collapses ── */}
      <div style={{
        position:'absolute',
        top: avatarLerp(58, 30),
        left:0, right:0,
        display:'flex', justifyContent:'center',
        zIndex:30, pointerEvents: avatarProgress > 0.5 ? 'none' : 'auto',
        opacity: 1 - avatarProgress,
        transform: `scale(${avatarLerp(1, 0.7)})`,
      }}>
        <div style={{ position:'relative', display:'inline-block', pointerEvents:'auto' }}>
          <div style={{ width:84, height:84, borderRadius:'50%', border:'4px solid #F4F6FA',
                        background:g.logoColor || g.logo_color || "linear-gradient(135deg,#19BFFF,#0098F0)", display:'flex', alignItems:'center',
                        justifyContent:'center', color:'#fff', fontSize:32, fontWeight:800,
                        position:'relative', overflow:'hidden',
                        boxShadow:'0 6px 16px rgba(16,24,40,0.18)' }}>
            {g.avatar_url
              ? <img src={g.avatar_url} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>
              : <>
                  <span style={{ position:'relative', zIndex:1 }}>{g.initial || (g.name || "G")[0].toUpperCase()}</span>
                  <div style={{ position:'absolute', inset:0, background:
                    'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 13px)' }}/>
                </>
            }
          </div>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto' }} onScroll={handleGroupScroll}>

        {/* Spacer so content starts below the floating avatar */}
        <div style={{ height:50 }}/>

        {/* ── Name + desc ─────────────────────────────────── */}
        <div style={{ padding:'11px 24px 0', textAlign:'center' }}>
          <div style={{ fontSize:23, fontWeight:700, letterSpacing:-0.3, color:C.ink }}>{g.name}</div>
          <div style={{ fontSize:15, lineHeight:1.55, color:'#7B8499', marginTop:6,
                        display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
            {g.desc || g.description || ""}
          </div>
        </div>

        {/* ── Stats ───────────────────────────────────────── */}
        <div style={{ display:'flex', justifyContent:'center', gap:34, marginTop:16 }}>
          {[{v: liveMembers ?? '—', l:'Members'},{v: livePosts2 ?? '—', l:'Posts'},{v: liveEvents2 !== null ? (liveEvents2 === 0 ? '—' : liveEvents2) : '—', l:'Events'}].map(s => (
            <div key={s.l} style={{ textAlign:'center' }}>
              <div style={{ fontSize:20, fontWeight:800, color:C.ink }}>{s.v}</div>
              <div style={{ fontSize:14, color:C.subtle, fontWeight:600, marginTop:1 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* ── Action row ──────────────────────────────────── */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:12, padding:'18px 16px 0' }}>

        {membershipChecked && (isJoined && isGroupAdmin ? (
          <>
            {/* Explore — group analytics */}
            <button onClick={() => navigate('group-analytics', { groupId: g.id })} style={{
              flex:'0 1 170px', height:46, borderRadius:999, border:'none',
              background:C.ink, color:'#fff', boxShadow:'0 8px 20px rgba(14,23,38,0.28)',
              fontSize:17, fontWeight:800, cursor:'pointer',
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            }}>
              <span>Explore</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M5 19V11M12 19V5M19 19v-7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
              </svg>
            </button>

            {/* Edit — group manage */}
            <button onClick={() => navigate('group-manage', { groupId: g.id })} style={{
              flex:'0 1 170px', height:46, borderRadius:999, border:'none',
              background:C.ink, color:'#fff', boxShadow:'0 8px 20px rgba(14,23,38,0.28)',
              fontSize:17, fontWeight:800, cursor:'pointer',
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            }}>
              <span>Edit</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="#fff" strokeWidth="1.9"/>
                <path d="M19.4 13a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V19a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-.3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"
                      stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/>
              </svg>
            </button>

            {/* Messages */}
            <button onClick={() => navigate('messages')} style={{
              position:'relative', width:46, height:46, border:'none',
              borderRadius:'50%', flexShrink:0, background:'#fff', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 4px 12px rgba(16,24,40,0.08)',
            }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
                <path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3.5V16.5H6a2 2 0 0 1-2-2Z"
                      stroke={C.body} strokeWidth="1.9" strokeLinejoin="round"/>
              </svg>
              <span style={{ position:'absolute', top:-2, right:-2, minWidth:18, height:18,
                             padding:'0 4px', borderRadius:999, background:C.primary,
                             color:'#fff', fontSize:12, fontWeight:800,
                             display:'flex', alignItems:'center', justifyContent:'center',
                             border:'2px solid #F4F6FA' }}>5</span>
            </button>
          </>
        ) : (
          <>
          {/* Primary button */}
          <button onClick={handlePrimary} disabled={membershipMutating} style={{
            flex:'0 1 auto', height:46, padding:'0 24px', borderRadius:999, border:btn.border||'none',
            background:btn.bg, color:btn.color, boxShadow:btn.shadow,
            fontSize:17, fontWeight:800, cursor: membershipMutating ? 'default' : 'pointer',
            opacity: membershipMutating ? 0.7 : 1,
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:8,
          }}>
            <span style={{ whiteSpace:'nowrap' }}>{btn.label}</span>
            {btn.icon === 'check' && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" fill="rgba(255,255,255,0.25)"/>
                <path d="m8 12 2.5 2.5L16 9" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            {btn.icon === 'plus' && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" fill="rgba(255,255,255,0.18)"/>
                <path d="M12 8v8M8 12h8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
              </svg>
            )}
          </button>

          {/* Private: static lock icon */}
          {isPrivate && (
            <div style={{ width:46, height:46, borderRadius:'50%', flexShrink:0,
                          background:'#fff', display:'flex', alignItems:'center',
                          justifyContent:'center', boxShadow:'0 4px 12px rgba(16,24,40,0.08)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="11" width="14" height="9" rx="2.2" stroke={C.body} strokeWidth="1.9"/>
                <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke={C.body} strokeWidth="1.9"/>
              </svg>
            </div>
          )}

          {/* Public: bell button */}
          {!isPrivate && (
            <button onClick={() => setNotifyOn(v => !v)} style={{
              position:'relative', width:46, height:46, border:'none',
              borderRadius:'50%', flexShrink:0, background:'#fff', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 4px 12px rgba(16,24,40,0.08)',
            }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
                <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5Z"
                      stroke={notifyOn ? C.primary : '#7B8499'}
                      fill={notifyOn ? C.primary : 'rgba(0,0,0,0)'}
                      strokeWidth="1.9" strokeLinejoin="round"/>
                <path d="M10 19.5a2.2 2.2 0 0 0 4 0"
                      stroke={notifyOn ? C.primary : '#7B8499'}
                      strokeWidth="1.9" strokeLinecap="round"/>
                {!notifyOn && <path d="M4 5 20 19" stroke="#7B8499" strokeWidth="1.9" strokeLinecap="round"/>}
              </svg>
              {isJoined && notifyOn && (
                <span style={{ position:'absolute', top:-2, right:-2, minWidth:18, height:18,
                               padding:'0 4px', borderRadius:999, background:C.primary,
                               color:'#fff', fontSize:12, fontWeight:800,
                               display:'flex', alignItems:'center', justifyContent:'center',
                               border:'2px solid #F4F6FA' }}>5</span>
              )}
            </button>
          )}

          </>
        ))}
        </div>

        {/* Admin-pinned event */}
        {pinnedEvent && (() => {
          const d = new Date(pinnedEvent.full_date || pinnedEvent.date || '');
          const day = !isNaN(d) ? String(d.getDate()) : '–';
          const mon = !isNaN(d) ? d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase() : '';
          const when = pinnedEvent.time_range ? fmtRange(pinnedEvent.time_range)
            : pinnedEvent.start_time ? fmt12(pinnedEvent.start_time) : '';
          const location = [pinnedEvent.location, pinnedEvent.venue]
            .map(value => typeof value === 'string' ? value.trim() : '')
            .find(Boolean) || '';
          return (
            <div onClick={() => navigate('event-details', { eventId: pinnedEvent.id })}
              style={{ margin:'16px 16px 0', display:'flex', alignItems:'center', gap:13,
                       background:'#fff', borderRadius:18, boxShadow:'0 4px 16px rgba(16,24,40,0.06)',
                       padding:13, cursor:'pointer' }}>
              <div style={{ width:64, height:64, borderRadius:'50%', flexShrink:0, position:'relative',
                            overflow:'hidden', display:'flex', flexDirection:'column',
                            alignItems:'center', justifyContent:'center',
                            background: pinnedEvent.image_url ? '#000' : C.grad }}>
                {pinnedEvent.image_url && (
                  <img src={pinnedEvent.image_url} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', opacity:0.55 }}/>
                )}
                <span style={{ position:'relative', fontSize:22, fontWeight:800, color:'#fff', lineHeight:1, textShadow:'0 1px 4px rgba(0,0,0,0.4)' }}>{day}</span>
                <span style={{ position:'relative', fontSize:12, fontWeight:700, color:'#fff', letterSpacing:0.5, marginTop:2, textShadow:'0 1px 4px rgba(0,0,0,0.4)' }}>{mon}</span>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:17, fontWeight:800, color:C.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                  {pinnedEvent.title}
                </div>
                {location && (
                  <div style={{ fontSize:14.5, color:C.subtle, marginTop:2, whiteSpace:'normal', overflowWrap:'anywhere' }}>
                    {location}
                  </div>
                )}
                {when && (
                  <div style={{ fontSize:14.5, color:C.primary, fontWeight:700, marginTop:5 }}>
                    {when}
                  </div>
                )}
              </div>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
                <line x1="12" y1="17" x2="12" y2="22" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round"/>
                <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          );
        })()}

        {/* ══ PRIVATE VIEW ════════════════════════════════════ */}
        {isPrivate && (
          <>
            {/* Group Details card */}
            <div style={{ margin:'16px 16px 0', background:'#fff', borderRadius:18,
                          boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:16 }}>
              <div style={{ fontSize:18, fontWeight:800, color:C.ink, marginBottom:13 }}>
                Group Details
              </div>
              {[
                {
                  icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="9" rx="2.2" stroke="#7B8499" strokeWidth="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="#7B8499" strokeWidth="1.8"/></svg>,
                  label:'Private Group', val:'Approval Required', valColor:C.primary,
                },
                {
                  icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#7B8499" strokeWidth="1.8"/><path d="M12 7.5V12l3 2" stroke="#7B8499" strokeWidth="1.8" strokeLinecap="round"/></svg>,
                  label:'Created', val:'March 2023', valColor:C.body,
                },
                {
                  icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke="#7B8499" strokeWidth="1.8"/><path d="M5 20c0-3.6 3-5.6 7-5.6s7 2 7 5.6" stroke="#7B8499" strokeWidth="1.8" strokeLinecap="round"/></svg>,
                  label:'Admin', val:'Emma Thompson', valColor:C.body,
                },
              ].map((row,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:11,
                                       padding:'9px 0',
                                       borderTop: i>0 ? `1px solid ${C.divider}` : 'none' }}>
                  {row.icon}
                  <span style={{ flex:1, fontSize:15.5, fontWeight:600, color:'#3A4252' }}>
                    {row.label}
                  </span>
                  <span style={{ fontSize:15, fontWeight:700, color:row.valColor }}>
                    {row.val}
                  </span>
                </div>
              ))}
            </div>

            {/* Group Rules card (private) */}
            <div style={{ margin:'14px 16px 0', background:'#fff', borderRadius:18,
                          boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:16 }}>
              <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:13 }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" fill={C.primary}/>
                  <path d="M12 11v5M12 8h.01" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <span style={{ fontSize:18, fontWeight:800, color:C.ink }}>Group Rules</span>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {(g.rules || ['Be respectful','No spam','Keep it on-topic','Credit sources']).map((r,i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:9 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
                      <path d="M5 12.5l4.5 4.5L19 7" stroke="#C2493D" strokeWidth="2.4"
                            strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span style={{ fontSize:15.5, fontWeight:500, color:C.muted }}>{r}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ height:24 }}/>
          </>
        )}

        {/* Social links — visible to all */}
        {(() => {
          const sl = g.social_links || {};
          const links = [
            { key:'instagram', icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="5" stroke="#39414F" strokeWidth="1.8"/><circle cx="12" cy="12" r="3.4" stroke="#39414F" strokeWidth="1.8"/><circle cx="16.5" cy="7.5" r="1" fill="#39414F"/></svg>, getUrl: v => `https://instagram.com/${v.replace(/^@/,'')}` },
            { key:'tiktok',    icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14 4v9.5a3.5 3.5 0 1 1-3-3.46V13a1 1 0 1 0 1 1V4h2c.3 1.8 1.7 3.2 3.5 3.5v2c-1.3-.1-2.5-.5-3.5-1.2" stroke="#39414F" strokeWidth="1.6" strokeLinejoin="round"/></svg>, getUrl: v => `https://tiktok.com/@${v.replace(/^@/,'')}` },
            { key:'website',   icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="#39414F" strokeWidth="1.7"/><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" stroke="#39414F" strokeWidth="1.7"/></svg>, getUrl: v => v.startsWith('http') ? v : `https://${v}` },
            { key:'discord',   icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" stroke="#39414F" strokeWidth="1.7"/><path d="m4 7 8 6 8-6" stroke="#39414F" strokeWidth="1.7" strokeLinejoin="round"/></svg>, getUrl: v => v.startsWith('http') ? v : `https://discord.gg/${v}` },
          ].filter(l => sl[l.key]);
          if (links.length === 0) return null;
          return (
            <div style={{ display:'flex', justifyContent:'center', gap:20, padding:'16px 0 4px' }}>
              {links.map(l => (
                <a key={l.key} href={l.getUrl(sl[l.key])} target="_blank" rel="noopener noreferrer"
                  style={{ width:38, height:38, borderRadius:11, background:'#fff',
                           display:'flex', alignItems:'center', justifyContent:'center',
                           textDecoration:'none',
                           boxShadow:'0 3px 8px rgba(16,24,40,0.06)' }}>
                  {l.icon}
                </a>
              ))}
            </div>
          );
        })()}

        {/* ══ PUBLIC VIEW ═════════════════════════════════════ */}
        {canSee && (
          <>
            {/* Tabs */}
            <div style={{ display:'flex', padding:'8px 0 0', marginTop:14 }}>
              {['posts','events','media','rules'].map(t => (
                <button key={t} onClick={() => setActiveTab(t)} style={{
                  flex:1, border:'none', background:'none', cursor:'pointer',
                  fontFamily:"'Montserrat',-apple-system,sans-serif",
                  fontSize:16, padding:'0 0 11px',
                  fontWeight: t===activeTab ? 800 : 700,
                  color: t===activeTab ? C.primary : C.subtle,
                  textTransform:'capitalize',
                }}>
                  {t.charAt(0).toUpperCase()+t.slice(1)}
                </button>
              ))}
            </div>

            {/* Tab content — swipeable */}
            <div
              onTouchStart={handleTabTouchStart}
              onTouchEnd={handleTabTouchEnd}
              style={{ padding:'14px 16px 100px', display:'flex', flexDirection:'column', gap:14 }}>

              {/* POSTS */}
              {activeTab === 'posts' && (
                <>

                {postsLoading ? (
                  <div style={{ textAlign:'center', padding:32, color:C.subtle }}>Loading posts…</div>
                ) : livePosts.length === 0 ? (
                  <div style={{ textAlign:'center', padding:32, color:C.subtle }}>No posts yet. Be the first!</div>
                ) : livePosts.map((p) => (
                  <PostCard key={p.id} p={p} postLiked={postLiked} togglePostLike={togglePostLike} currentUser={currentUser} showToast={showToast}
                    navigate={navigate} isGroupAdmin={isGroupAdmin} deletePost={deletePost} togglePinPost={togglePinPost} />
                ))}
                </>
              )}

              {/* EVENTS */}
              {activeTab === 'events' && (
                <>
                {isJoined && (
                  <button onClick={() => navigate('create-event', { groupId })}
                    style={{ width:'100%', height:44, border:`1.5px dashed ${C.primary}`, borderRadius:14,
                             background:'rgba(2,162,240,0.05)', color:C.primary, fontSize:15,
                             fontWeight:800, cursor:'pointer', display:'flex', alignItems:'center',
                             justifyContent:'center', gap:8,
                             fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M12 5v14M5 12h14" stroke={C.primary} strokeWidth="2.2" strokeLinecap="round"/>
                    </svg>
                    Create Event
                  </button>
                )}
                {groupEvents.length === 0
                  ? <div style={{ textAlign:'center', padding:'32px 0', color:C.subtle, fontSize:14 }}>No upcoming events</div>
                  : [...groupEvents].sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0)).map(ev => {
                    const d = ev.date ? new Date(ev.date) : null;
                    const day = d ? d.getDate().toString() : '';
                    const mon = d ? d.toLocaleString('en',{month:'short'}).toUpperCase() : '';
                    const grad = THEME[ev.category || ev.primary]?.grad || 'linear-gradient(135deg,#7C5CFF,#02B6FE)';
                    const togglePinEvent = async (e) => {
                      e.stopPropagation();
                      const nextPinned = !ev.is_pinned;
                      const { error } = await supabase.from('events').update({ is_pinned: nextPinned }).eq('id', ev.id);
                      if (error) { showToast('Could not update pin: ' + error.message); return; }
                      setGroupEvents(prev => prev.map(x => x.id === ev.id ? { ...x, is_pinned: nextPinned } : x));
                      showToast(nextPinned ? 'Event pinned to top' : 'Event unpinned');
                    };
                    return (
                      <div key={ev.id} onClick={() => navigate('event-details',{eventId:ev.id})}
                        style={{ display:'flex', gap:13, background:'#fff', borderRadius:18,
                                 boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:13, cursor:'pointer', marginBottom:10 }}>
                        <div style={{ width:58, height:58, borderRadius:14, flexShrink:0,
                                      background:grad, position:'relative', overflow:'hidden',
                                      display:'flex', flexDirection:'column', alignItems:'center',
                                      justifyContent:'center', color:'#fff' }}>
                          {ev.image_url
                            ? <img src={ev.image_url} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>
                            : <div style={{ position:'absolute', inset:0, background:
                                'repeating-linear-gradient(135deg,rgba(255,255,255,0.14) 0,rgba(255,255,255,0.14) 2px,transparent 2px,transparent 9px)'}}/>}
                          <span style={{ position:'relative', fontSize:20, fontWeight:800, lineHeight:1 }}>{day}</span>
                          <span style={{ position:'relative', fontSize:11.5, fontWeight:700, letterSpacing:0.5, marginTop:2 }}>{mon}</span>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            <div style={{ fontSize:16.5, fontWeight:800, color:C.ink, lineHeight:1.25, flex:1, minWidth:0,
                                          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{ev.title}</div>
                            {ev.is_pinned && (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
                                <line x1="12" y1="17" x2="12" y2="22" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round"/>
                                <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                          <div style={{ fontSize:14, color:C.subtle, marginTop:4 }}>
                            {fmtDate(ev.full_date || ev.date)}{(ev.start_time || ev.time_range) ? ` · ${fmtRange(ev.time_range) || fmt12(ev.start_time)}` : ''}
                          </div>
                          {(ev.location || ev.venue) && (
                            <div style={{ fontSize:13.5, color:C.subtle, marginTop:2, whiteSpace:'nowrap',
                                          overflow:'hidden', textOverflow:'ellipsis' }}>{ev.venue || ev.location}</div>
                          )}
                          <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:7 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                              <circle cx="9" cy="8.5" r="3" stroke={C.primary} strokeWidth="1.8"/>
                              <path d="M3.5 19c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" stroke={C.primary} strokeWidth="1.8" strokeLinecap="round"/>
                            </svg>
                            <span style={{ fontSize:13.5, fontWeight:700, color:C.primary }}>{ev.attendees_count || ev.going || 0} going</span>
                          </div>
                        </div>
                        {isGroupAdmin && (
                          <button onClick={togglePinEvent} aria-label={ev.is_pinned ? 'Unpin event' : 'Pin event'} aria-pressed={!!ev.is_pinned} style={{ width:32, height:32, border:'none', borderRadius:10,
                            background: ev.is_pinned ? '#EAF6FF' : C.chip, display:'flex', alignItems:'center',
                            justifyContent:'center', cursor:'pointer', flexShrink:0, alignSelf:'flex-start' }}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                              <g transform="rotate(45 12 12)">
                                <line x1="12" y1="17" x2="12" y2="22" stroke={ev.is_pinned ? C.primary : C.subtle} strokeWidth="1.9" strokeLinecap="round"/>
                                <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" stroke={ev.is_pinned ? C.primary : C.subtle} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                              </g>
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })
                }
                </>
              )}

              {/* MEDIA */}
              {activeTab === 'media' && (
                mediaImages.length === 0
                  ? <div style={{ textAlign:'center', padding:'32px 0', color:C.subtle, fontSize:14 }}>No photos yet</div>
                  : <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6 }}>
                    {mediaImages.map((m) => (
                      <div key={m.id}
                        style={{ position:'relative', aspectRatio:'1', borderRadius:10,
                                 overflow:'hidden', background:C.chip, cursor:'pointer' }}>
                        <img src={m.image_url} alt=""
                          style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>
                      </div>
                    ))}
                  </div>
              )}

              {/* RULES */}
              {activeTab === 'rules' && (
                <div style={{ background:'#fff', borderRadius:18,
                              boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:'6px 16px' }}>
                  {(g.rules || ['Be respectful','No spam','Keep it on-topic','Credit sources']).map((r,i,arr) => (
                    <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:12,
                                           padding:'14px 0',
                                           borderBottom: i<arr.length-1 ? `1px solid ${C.divider}` : 'none' }}>
                      <div style={{ width:26, height:26, borderRadius:8, flexShrink:0,
                                    background:'#E9F6FF', display:'flex', alignItems:'center',
                                    justifyContent:'center', fontSize:15, fontWeight:800,
                                    color:C.primary }}>{i+1}</div>
                      <span style={{ flex:1, fontSize:15.5, fontWeight:600, lineHeight:1.45,
                                     color:C.body, marginTop:2 }}>{r}</span>
                    </div>
                  ))}
                </div>
              )}

            </div>
          </>
        )}

      </div>{/* end scroll */}

      {/* ── FAB: Compose (joined) ────────────────────────── */}
      {isJoined && (
        <button onClick={() => navigate('create-post', { groupId })} style={{
          position:'absolute', bottom:22, right:16, width:52, height:52,
          border:'none', borderRadius:'50%', background:C.grad,
          display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', boxShadow:'0 10px 24px rgba(2,162,240,0.45)', zIndex:6,
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M5 19h3l9-9-3-3-9 9v3Z" stroke="#fff" strokeWidth="1.9" strokeLinejoin="round"/>
            <path d="m14.5 6.5 3 3" stroke="#fff" strokeWidth="1.9" strokeLinecap="round"/>
          </svg>
        </button>
      )}

      {/* ── Options bottom sheet ────────────────────────── */}
      {showOptionsSheet && (
        <div onClick={() => setShowOptionsSheet(false)} style={{
          position:'absolute', inset:0, zIndex:50,
          background:'rgba(14,23,38,0.45)', display:'flex', alignItems:'flex-end',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width:'100%', background:'#fff', borderRadius:'22px 22px 0 0',
            padding:'10px 0 40px', fontFamily:"'Montserrat',-apple-system,sans-serif",
          }}>
            <div style={{ width:38, height:4, borderRadius:99, background:'#D1D8E4',
                          margin:'0 auto 18px' }}/>
            {/* Notification toggle */}
            {[
              { label: notifyOn ? 'Turn off notifications' : 'Turn on notifications',
                icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5Z" stroke={C.body} strokeWidth="1.9" strokeLinejoin="round"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0" stroke={C.body} strokeWidth="1.9" strokeLinecap="round"/></svg>,
                action: () => { setNotifyOn(v => !v); showToast(notifyOn ? 'Notifications off' : 'Notifications on'); setShowOptionsSheet(false); } },
              { label:'Share Group',
                icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" stroke={C.body} strokeWidth="1.9" strokeLinecap="round"/><path d="M16 6l-4-4-4 4M12 2v13" stroke={C.body} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>,
                action: () => { if (navigator.share) { navigator.share({ title: g.name, text: g.description || '' }); } else { showToast('Link copied!'); } setShowOptionsSheet(false); } },
              ...(isJoined ? [{ label:'Leave Group', danger:true,
                icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="#C2493D" strokeWidth="1.9" strokeLinecap="round"/><path d="M16 17l5-5-5-5M21 12H9" stroke="#C2493D" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>,
                action: async () => {
                  setShowOptionsSheet(false); setJoinState('join'); setIsGroupAdmin(false);
                  const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', user.id);
                  if (error) {
                    setJoinState('joined'); setIsGroupAdmin(isGroupAdmin);
                    showToast('Failed to leave: ' + error.message);
                    return;
                  }
                  refreshCounts(); showToast('You left the group');
                }}] : []),
              { label:'Report Group', danger:true,
                icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01" stroke="#C2493D" strokeWidth="2" strokeLinecap="round"/><path d="M10.3 3.5 2 20h20L13.7 3.5a2 2 0 0 0-3.4 0Z" stroke="#C2493D" strokeWidth="1.9" strokeLinejoin="round"/></svg>,
                action: () => { showToast('Report submitted'); setShowOptionsSheet(false); } },
            ].map((opt, i) => (
              <button key={i} onClick={opt.action} style={{
                width:'100%', display:'flex', alignItems:'center', gap:15,
                padding:'15px 20px', border:'none', background:'none', cursor:'pointer',
                fontFamily:"'Montserrat',-apple-system,sans-serif",
                borderTop:`1px solid ${C.divider}`,
              }}>
                {opt.icon}
                <span style={{ fontSize:16, fontWeight:700, color: opt.danger ? '#C2493D' : C.ink }}>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: EVENT DETAILS
// ─────────────────────────────────────────────────────────────
function EventDetailsScreen({ eventId, liked, toggleLike, saved, toggleSave, shared, recordShare, navigate, goBack, showToast, role }) {
  const [dbEvent, setDbEvent] = useState(null);
  useEffect(() => {
    if (!eventId) return;
    supabase.from('events').select('*').eq('id', eventId)
      .or('status.is.null,status.eq.published')
      .single()
      .then(async ({ data }) => {
        if (!data) return;
        if (data.user_id) {
          const { data: u } = await supabase.from('users').select('name,avatar_url,avatar_color').eq('id', data.user_id).single();
          if (u) {
            data.org         = u.name || data.org;
            data.orgInitial  = (u.name || data.org || 'O')[0].toUpperCase();
            data.org_avatar  = u.avatar_url || null;
            data.org_color   = u.avatar_color || null;
          }
        }
        setDbEvent(data);
      });
  }, [eventId]);
  const ev = dbEvent || EVENTS.find(e => e.id === eventId) || EVENTS[0];
  const th = THEME[ev.primary || ev.category] || THEME.social;
  const [expanded, setExpanded] = useState(false);
  const isLiked = !!liked[ev.id], isSaved = !!saved[ev.id], isShared = !!shared[ev.id];

  const attendeeCount = ev.attendee_count || ev.attendees || 0;

  // Real "You may also like": other published events in the same category,
  // not the static mock EVENTS array (which always surfaced whatever mock
  // event happened to share a tag, regardless of what's actually posted).
  const [similar, setSimilar] = useState([]);
  useEffect(() => {
    if (!dbEvent?.id) return;
    let cancelled = false;
    supabase.from('events').select('*')
      .eq('category', dbEvent.category).neq('id', dbEvent.id)
      .or('status.is.null,status.eq.published')
      .order('created_at', { ascending: false }).limit(2)
      .then(({ data }) => { if (!cancelled) setSimilar(data || []); });
    return () => { cancelled = true; };
  }, [dbEvent?.id, dbEvent?.category]);
  // Derived at render time rather than reset in the effect above -- avoids a
  // second synchronous setState-in-effect for what's really just "there's no
  // real event yet, so there's nothing to recommend".
  const similarEvents = dbEvent?.id ? similar : [];

  const HeaderBtn = ({ onClick, children }) => (
    <button onClick={onClick} style={{ width:38, height:38, border:'none', borderRadius:12,
      background:C.chip, display:'flex', alignItems:'center', justifyContent:'center',
      cursor:'pointer', flexShrink:0 }}>
      {children}
    </button>
  );

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      {/* ── Sticky header ────────────────────────────────── */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)', backdropFilter:'blur(16px)',
                    padding:'50px 12px 12px', display:'flex', alignItems:'center', gap:7,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', zIndex:6 }}>
        <HeaderBtn onClick={goBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M14 6l-6 6 6 6" stroke={C.body} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </HeaderBtn>
        <div style={{ flex:1, textAlign:'center', fontSize:16, fontWeight:800,
                      letterSpacing:-0.4, color:C.ink, whiteSpace:'nowrap',
                      overflow:'hidden', textOverflow:'ellipsis' }}>{ev.title}</div>
        <HeaderBtn onClick={async () => {
          const shareData = {
            title: ev.title,
            text: `${ev.title} — ${fmtDate(ev.fullDate || ev.full_date || ev.date)}${ev.time_range ? ' · ' + fmtRange(ev.time_range) : ''}`,
            url: window.location.href,
          };
          let didShare = false;
          if (navigator.share) {
            try { await navigator.share(shareData); didShare = true; } catch {}
          } else {
            try {
              await navigator.clipboard.writeText(`${shareData.title}\n${shareData.text}\n${shareData.url}`);
              showToast('Event link copied to clipboard');
              didShare = true;
            } catch { showToast('Could not share'); }
          }
          if (didShare) recordShare(ev.id);
        }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <circle cx="18" cy="5" r="3" fill={isShared ? '#FF8A3D' : 'none'} stroke={isShared ? '#FF8A3D' : '#39414F'} strokeWidth="1.8"/>
            <circle cx="6" cy="12" r="3" fill={isShared ? '#FF8A3D' : 'none'} stroke={isShared ? '#FF8A3D' : '#39414F'} strokeWidth="1.8"/>
            <circle cx="18" cy="19" r="3" fill={isShared ? '#FF8A3D' : 'none'} stroke={isShared ? '#FF8A3D' : '#39414F'} strokeWidth="1.8"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" stroke={isShared ? '#FF8A3D' : '#39414F'} strokeWidth="1.8"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" stroke={isShared ? '#FF8A3D' : '#39414F'} strokeWidth="1.8"/>
          </svg>
        </HeaderBtn>
        <HeaderBtn onClick={() => { toggleSave(ev.id); showToast(isSaved ? 'Removed from saved' : 'Event saved!'); }}>
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z"
                  fill={isSaved ? C.primary : 'rgba(0,0,0,0)'}
                  stroke={isSaved ? C.primary : '#39414F'} strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
        </HeaderBtn>
        <HeaderBtn onClick={() => { toggleLike(ev.id); showToast(isLiked ? 'Like removed' : 'You liked this event!'); }}>
          <svg width="17" height="17" viewBox="0 0 24 24">
            <path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7C20.5 15 12 20.5 12 20.5Z"
                  fill={isLiked ? '#FF3B6B' : 'rgba(0,0,0,0)'}
                  stroke={isLiked ? '#FF3B6B' : '#39414F'} strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
        </HeaderBtn>
      </div>

      {/* ── Scrollable body ──────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', padding:'14px 16px 110px' }}>

        {/* Hero banner */}
        {(() => {
          const HERO_IMGS = {
            social:    'https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=900&q=80',
            sports:    'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=900&q=80',
            academic:  'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=900&q=80',
            arts:      'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=900&q=80',
            wellness:  'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=900&q=80',
            career:    'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=900&q=80',
          };
          const heroImg = ev.image_url || ev.imageUrl || HERO_IMGS[ev.primary] || HERO_IMGS.social;
          return (
            <div style={{ position:'relative', height:206, borderRadius:20, overflow:'hidden',
                          boxShadow:'0 10px 28px rgba(16,24,40,0.12)' }}>
              <img src={heroImg} alt={ev.title}
                   style={{ width:'100%', height:'100%', objectFit:'cover', objectPosition:'center' }}/>
              <div style={{ position:'absolute', inset:0,
                background:'linear-gradient(to top,rgba(14,23,38,0.75) 0%,rgba(14,23,38,0.2) 55%,transparent 100%)' }}/>
              <div style={{ position:'absolute', top:12, left:12, display:'inline-flex',
                            alignItems:'center', height:24, padding:'0 10px', borderRadius:999,
                            background:'rgba(255,255,255,0.92)', fontSize:12, fontWeight:700, color:C.body }}>
                {th.label} · Event
              </div>
              <div style={{ position:'absolute', bottom:14, left:14, right:14 }}>
                <div style={{ fontSize:22, fontWeight:800, color:'#fff', letterSpacing:-0.5,
                              lineHeight:1.2, textShadow:'0 1px 6px rgba(0,0,0,0.5)' }}>{ev.title}</div>
              </div>
              {ev.badge && (
                <div style={{ position:'absolute', top:12, right:12, display:'inline-flex',
                              alignItems:'center', height:24, padding:'0 10px', borderRadius:7,
                              background:'rgba(14,23,38,0.55)', fontSize:12, fontWeight:700, color:'#fff' }}>
                  {ev.badge}
                </div>
              )}
            </div>
          );
        })()}

        {/* Organizer card — tapping through to the group page only makes
            sense when the event actually belongs to a group; a solo
            organizer (no group_id) has no profile page to show here.
            The old "Follow" button here was wired to toggleRsvp (event
            RSVPs), so tapping it silently created a fake RSVP row and fired
            the organizer's "someone's attending your event" notification --
            removed rather than reusing that, since GroupProfileScreen
            already has its own real join/request state for this group. */}
        <div onClick={() => ev.group_id && navigate('group-profile', { groupId: ev.group_id })}
          style={{ marginTop:13, background:C.card, borderRadius:16,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:'12px 15px',
                      display:'flex', alignItems:'center', gap:11,
                      cursor: ev.group_id ? 'pointer' : 'default' }}>
          <div style={{ width:44, height:44, borderRadius:13, flexShrink:0,
                        background: ev.org_avatar ? 'transparent' : (ev.org_color || th.grad),
                        display:'flex', alignItems:'center', overflow:'hidden',
                        justifyContent:'center', color:'#fff', fontSize:16, fontWeight:800 }}>
            {ev.org_avatar
              ? <img src={ev.org_avatar} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
              : (ev.orgInitial || 'O')}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ fontSize:16, fontWeight:800, color:C.ink }}>{ev.org}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 2.5l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.6.6 2.6-2.3 1.4-1 2.5-2.7-.2L12 21.5 9.8 19.9l-2.7.2-1-2.5-2.3-1.4.6-2.6L3.8 11l2.3-1.4 1-2.5 2.7.2L12 2.5Z" fill="#02B6FE"/>
                <path d="m9 12 2 2 4-4.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{ fontSize:13, color:'#8A93A6', marginTop:2 }}>Verified Organizer</div>
          </div>
          {ev.group_id && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
              <path d="M9 6l6 6-6 6" stroke="#C5CBD6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>

        {/* Info card */}
        <div style={{ marginTop:13, background:C.card, borderRadius:16,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:'4px 15px' }}>
          {/* Date & Time */}
          <div style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'13px 0',
                        borderBottom:`1px solid ${C.divider}` }}>
            <div style={{ width:36, height:36, borderRadius:10, flexShrink:0, background:'#E9F6FF',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke={C.primary} strokeWidth="1.9"/>
                <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                            textTransform:'uppercase', color:C.subtle }}>Date &amp; Time</div>
              <div style={{ fontSize:15, fontWeight:700, color:C.body, marginTop:3 }}>{fmtDate(ev.fullDate || ev.full_date || ev.date)}</div>
              <div style={{ fontSize:13, color:'#6B7385', marginTop:1 }}>{fmtRange(ev.timeRange || ev.time_range)}</div>
              <button onClick={() => addToCalendar({ title: ev.title, location: ev.venue || ev.location, description: ev.description, dateStr: ev.fullDate || ev.full_date || ev.date, timeStr: ev.start_time, durationMins: 90 })} style={{
                marginTop:8, display:'inline-flex', alignItems:'center', gap:5,
                height:28, padding:'0 11px', border:`1.5px solid ${C.border}`, background:'#fff',
                borderRadius:999, fontSize:13, fontWeight:700, color:C.primary,
                cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M12 5v14M5 12h14" stroke={C.primary} strokeWidth="2.2" strokeLinecap="round"/>
                </svg>
                Add to Calendar
              </button>
            </div>
          </div>

          {/* Location */}
          <div style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'13px 0',
                        borderBottom:`1px solid ${C.divider}` }}>
            <div style={{ width:36, height:36, borderRadius:10, flexShrink:0, background:'#E9F6FF',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" stroke={C.primary} strokeWidth="1.9"/>
                <circle cx="12" cy="10" r="2.4" stroke={C.primary} strokeWidth="1.9"/>
              </svg>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                            textTransform:'uppercase', color:C.subtle }}>Location</div>
              <div style={{ fontSize:15, fontWeight:700, color:C.body, marginTop:3 }}>{ev.venue}</div>
              <div style={{ fontSize:13, color:'#6B7385', marginTop:1 }}>{ev.room}</div>
              {/* Map thumbnail — tappable, opens Google Maps */}
              {(() => {
                const addr = [ev.venue, ev.room, ev.location].filter(Boolean).join(', ');
                const query = encodeURIComponent(addr);
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${query}`;
                const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${query}`;
                const thumbUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${query}&zoom=15&size=600x200&markers=color:0x0098F0%7C${query}&style=feature:poi|visibility:off&key=AIzaSyD-placeholder`;
                return (
                  <>
                    <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                      style={{ display:'block', position:'relative', height:110, borderRadius:11,
                                overflow:'hidden', marginTop:10, textDecoration:'none',
                                background:'linear-gradient(135deg,#DCE7F0,#EDF2F7)', cursor:'pointer' }}>
                      {/* Grid overlay to look like a map */}
                      <div style={{ position:'absolute', inset:0, background:
                        'repeating-linear-gradient(0deg,rgba(150,165,185,0.15) 0,rgba(150,165,185,0.15) 1px,transparent 1px,transparent 22px),repeating-linear-gradient(90deg,rgba(150,165,185,0.15) 0,rgba(150,165,185,0.15) 1px,transparent 1px,transparent 22px)' }}/>
                      {/* Fake road lines */}
                      <div style={{ position:'absolute', top:'45%', left:0, right:0, height:8, background:'rgba(255,255,255,0.6)' }}/>
                      <div style={{ position:'absolute', top:0, bottom:0, left:'38%', width:6, background:'rgba(255,255,255,0.5)' }}/>
                      {/* Pin */}
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                        style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-70%)' }}>
                        <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" fill={C.primary}/>
                        <circle cx="12" cy="10" r="2.6" fill="#fff"/>
                      </svg>
                      {/* "Tap to open" hint */}
                      <div style={{ position:'absolute', bottom:7, right:9, background:'rgba(255,255,255,0.85)',
                        borderRadius:6, padding:'2px 7px', fontSize:11, fontWeight:700, color:C.primary }}>
                        Open Maps ↗
                      </div>
                    </a>
                    <div style={{ display:'flex', gap:8, marginTop:9 }}>
                      <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{
                        flex:1, height:34, border:`1.5px solid ${C.border}`, background:'#fff',
                        borderRadius:9, fontSize:13.5, fontWeight:700, color:C.body,
                        cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
                        display:'flex', alignItems:'center', justifyContent:'center', textDecoration:'none',
                      }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ marginRight:5 }}>
                          <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" stroke={C.body} strokeWidth="2"/>
                          <circle cx="12" cy="10" r="2.4" stroke={C.body} strokeWidth="2"/>
                        </svg>
                        View on Map
                      </a>
                      <a href={directionsUrl} target="_blank" rel="noopener noreferrer" style={{
                        flex:1, height:34, border:'none', background:'#E9F6FF',
                        borderRadius:9, fontSize:13.5, fontWeight:700, color:C.primary,
                        cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
                        display:'flex', alignItems:'center', justifyContent:'center', textDecoration:'none',
                      }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ marginRight:5 }}>
                          <path d="M3 12l7-7 7 7M12 5v14" stroke={C.primary} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" transform="rotate(90 12 12)"/>
                          <path d="M5 9l7-7 7 7M5 15l7 7 7-7" stroke={C.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Get Directions
                      </a>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Price */}
          {(() => {
            const { isFree: isFreeEv, amount: evPriceAmount } = parseEventPrice(ev.price);
            return (
              <div style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 0' }}>
                <div style={{ width:36, height:36, borderRadius:10, flexShrink:0,
                              background: isFreeEv ? '#E6F8F0' : '#FFF6E9',
                              display:'flex', alignItems:'center', justifyContent:'center' }}>
                  {isFreeEv ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="#10B981" strokeWidth="1.8"/>
                      <path d="M12 7v1.2M12 15.8V17M15 9.8a2.6 2.6 0 0 0-2.7-2 2.3 2.3 0 0 0-2.3 2c0 3 5 1.5 5 4.4a2.3 2.3 0 0 1-2.3 2 2.6 2.6 0 0 1-2.7-2" stroke="#10B981" strokeWidth="1.6" strokeLinecap="round"/>
                      <line x1="5.5" y1="18.5" x2="18.5" y2="5.5" stroke="#10B981" strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="#F59E0B" strokeWidth="1.8"/>
                      <path d="M12 7v1.2M12 15.8V17M15 9.8a2.6 2.6 0 0 0-2.7-2 2.3 2.3 0 0 0-2.3 2c0 3 5 1.5 5 4.4a2.3 2.3 0 0 1-2.3 2 2.6 2.6 0 0 1-2.7-2" stroke="#F59E0B" strokeWidth="1.6" strokeLinecap="round"/>
                    </svg>
                  )}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                                textTransform:'uppercase', color:C.subtle }}>Price</div>
                  <div style={{ fontSize:15, fontWeight:800, marginTop:3,
                                color: isFreeEv ? '#10B981' : '#F59E0B' }}>
                    {isFreeEv ? 'Free for students' : `$${evPriceAmount}`}
                  </div>
                </div>
                <span style={{ fontSize:12, fontWeight:800,
                               color: isFreeEv ? '#0E9F6E' : '#D97706',
                               background: isFreeEv ? '#E6F8F0' : '#FFF6E9',
                               padding:'4px 10px', borderRadius:999 }}>
                  Spots open
                </span>
              </div>
            );
          })()}
        </div>

        {/* About */}
        <div style={{ marginTop:13, background:C.card, borderRadius:16,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke={C.primary} strokeWidth="1.9"/>
              <path d="M12 11v5M12 8h.01" stroke={C.primary} strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize:16, fontWeight:800, color:C.ink }}>About This Event</span>
          </div>
          <div style={{ fontSize:14.5, lineHeight:1.65, color:C.muted }}>
            {expanded ? (ev.fullDesc || ev.full_desc || ev.description) : (ev.desc || ev.description)}
          </div>
          <button onClick={() => setExpanded(e => !e)} style={{ marginTop:8, border:'none',
            background:'none', padding:0, fontSize:14, fontWeight:800, color:C.primary,
            cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
            {expanded ? 'Show less' : 'Read more'}
          </button>
        </div>

        {/* Rules */}
        <div style={{ marginTop:13, background:C.card, borderRadius:16,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:11 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"
                    stroke={C.primary} strokeWidth="1.9" strokeLinejoin="round"/>
            </svg>
            <span style={{ fontSize:16, fontWeight:800, color:C.ink }}>Rules &amp; Guidelines</span>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
            {(ev.rules || []).map((r, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:9 }}>
                <div style={{ width:20, height:20, borderRadius:'50%', flexShrink:0,
                              background:'#E6F8F0', display:'flex', alignItems:'center',
                              justifyContent:'center' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12.5l4.5 4.5L19 7" stroke="#10B981" strokeWidth="2.6"
                          strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span style={{ fontSize:14, fontWeight:600, color:'#3A4252' }}>{r}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Attending */}
        {attendeeCount > 0 && (
          <div onClick={() => showToast('Viewing all attendees')}
            style={{ marginTop:13, background:C.card, borderRadius:16,
                     boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:14, cursor:'pointer' }}>
            <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                <circle cx="9" cy="8.5" r="3" stroke={C.ink} strokeWidth="1.8"/>
                <path d="M3.5 19c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" stroke={C.ink} strokeWidth="1.8" strokeLinecap="round"/>
                <path d="M16 6a3 3 0 0 1 0 5.5M17 14.6c2.6.3 4.5 1.8 4.5 4.4" stroke={C.ink} strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              <span style={{ fontSize:16, fontWeight:800, color:C.ink }}>Attending</span>
            </div>
            <div style={{ fontSize:14, color:'#6B7385' }}>
              <span style={{ fontWeight:800, color:C.body }}>{attendeeCount} attending</span>
            </div>
          </div>
        )}

        {/* Guest Speakers — only shown if event has guests */}
        {Array.isArray(ev.guests) && ev.guests.length > 0 && (
          <div style={{ marginTop:16 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                          padding:'0 2px 10px' }}>
              <span style={{ fontSize:16, fontWeight:800, color:C.ink }}>Guest Speakers</span>
            </div>
            <div style={{ display:'flex', gap:11, overflowX:'auto', padding:'2px 2px 4px',
                          scrollbarWidth:'none' }}>
              {ev.guests.map((g, i) => {
                const GRAD = ['linear-gradient(135deg,#FF5A8A,#FF8A3D)','linear-gradient(135deg,#7C5CFF,#B06BFF)','linear-gradient(135deg,#02B6FE,#0078E0)','linear-gradient(135deg,#10B981,#06B6D4)'];
                return (
                  <div key={i} style={{ flexShrink:0, width:116, background:C.card,
                                        borderRadius:14, boxShadow:'0 4px 14px rgba(16,24,40,0.06)',
                                        padding:11 }}>
                    <div style={{ height:84, borderRadius:11, background:GRAD[i % GRAD.length],
                                  position:'relative', overflow:'hidden', display:'flex',
                                  alignItems:'center', justifyContent:'center' }}>
                      <span style={{ fontSize:24, fontWeight:800, color:'#fff' }}>
                        {(g.name || '?')[0].toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize:14, fontWeight:800, color:C.ink, marginTop:8,
                                  whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {g.name}
                    </div>
                    {g.role && (
                      <div style={{ fontSize:12, color:'#8A93A6', marginTop:2, whiteSpace:'nowrap',
                                    overflow:'hidden', textOverflow:'ellipsis' }}>{g.role}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* You may also like */}
        {similarEvents.length > 0 && (
          <div style={{ marginTop:18 }}>
            <div style={{ fontSize:16, fontWeight:800, color:C.ink, marginBottom:11 }}>
              You May Also Like
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {similarEvents.map(e2 => (
                <div key={e2.id} onClick={() => navigate('event-details', {eventId:e2.id})}
                  style={{ display:'flex', gap:11, background:C.card, borderRadius:14,
                           boxShadow:'0 4px 14px rgba(16,24,40,0.06)', padding:10,
                           cursor:'pointer' }}>
                  <div style={{ width:68, height:68, borderRadius:11, flexShrink:0,
                                background:(THEME[e2.category||e2.primary]||THEME.social).grad,
                                position:'relative', overflow:'hidden' }}>
                    {e2.image_url
                      ? <img src={e2.image_url} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>
                      : <div style={{ position:'absolute', inset:0, background:
                          'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 13px)'}}/>}
                  </div>
                  <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column',
                                justifyContent:'center' }}>
                    <span style={{ fontSize:11, fontWeight:700, color:C.primary,
                                   background:'#E9F6FF', padding:'2px 7px', borderRadius:999,
                                   alignSelf:'flex-start' }}>
                      {(THEME[e2.category||e2.primary]||THEME.social).label}
                    </span>
                    <div style={{ fontSize:15, fontWeight:800, color:C.ink, marginTop:4,
                                  whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {e2.title}
                    </div>
                    <div style={{ fontSize:13, color:'#8A93A6', marginTop:2 }}>{fmtDate(e2.full_date || e2.date)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Floating buy button ───────────────────────────── */}
      <div style={{ position:'absolute', bottom:24, left:24, right:24, zIndex:6 }}>
        {role !== 'student' ? (
          <button onClick={() => navigate('check-in', {eventId: ev.id})} style={{
            width:'100%', height:54, border:'none', borderRadius:18, cursor:'pointer',
            background:'linear-gradient(135deg,#0E1726,#1A2538)', color:'#fff',
            fontSize:16, fontWeight:800,
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            boxShadow:'0 10px 28px rgba(14,23,38,0.35)',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Check In
          </button>
        ) : (
          <button onClick={() => navigate('tickets', {eventId: ev.id})} style={{
            width:'100%', height:54, border:'none', borderRadius:18, cursor:'pointer',
            background:C.grad, color:'#fff', fontSize:17, fontWeight:800,
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            boxShadow:'0 10px 28px rgba(2,162,240,0.45)',
          }}>
            {parseEventPrice(ev.price).isFree ? 'Reserve Spot' : 'Buy Ticket'}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}

function calcSpaceProgress(timeStr, dayStr, duration) {
  if (!timeStr || !dayStr) return null;
  const base = (dayStr === 'today' || dayStr === 'tomorrow') ? new Date() : new Date(dayStr + 'T00:00:00');
  if (isNaN(base)) return null;
  if (dayStr === 'tomorrow') base.setDate(base.getDate() + 1);
  const mx = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
  if (!mx) return null;
  let h = parseInt(mx[1]); const min = parseInt(mx[2] || '0'); const ap = (mx[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0;
  const startMs = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, min).getTime();
  const endMs = startMs + (parseInt(duration) || 60) * 60000;
  const nowMs = Date.now();
  if (nowMs < startMs) return null;
  return Math.min(100, Math.round(((nowMs - startMs) / (endMs - startMs)) * 100));
}

// ─────────────────────────────────────────────────────────────
// SCREEN: SPACE DETAILS
// ─────────────────────────────────────────────────────────────
function SpaceDetailsScreen({ spaceId, goBack, navigate, showToast, spaceSaved, toggleSaveSpace, currentUser }) {
  const { user } = useUser();
  const [dbSpace, setDbSpace] = useState(null);
  useEffect(() => {
    if (!spaceId) return;
    supabase.from('spaces').select('*').eq('id', spaceId).single()
      .then(async ({ data }) => {
        if (!data) return;
        if (data.host_id) {
          const { data: u } = await supabase.from('users').select('name,avatar_url,avatar_color').eq('id', data.host_id).single();
          if (u) {
            data.host_text   = u.name || data.host_text;
            data.host_name   = u.name || data.host_text;
            data.host_avatar = u.avatar_url || null;
            data.host_color  = u.avatar_color || null;
          }
        }
        setDbSpace(data);
      });
  }, [spaceId]);
  const sp = dbSpace || SPACES.find(s => s.id === spaceId) || null;
  const [joined,   setJoined]   = useState(false);
  const [liked,    setLiked]    = useState(false);
  const [followed, setFollowed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [realParticipants, setRealParticipants] = useState([]);

  useEffect(() => {
    if (!spaceId) return;
    supabase.from('space_participants')
      .select('user_id, users(name, avatar_url, avatar_color)')
      .eq('space_id', spaceId)
      .then(({ data }) => {
        setRealParticipants((data || []).map(p => ({
          avatar_url: p.users?.avatar_url || null,
          color: p.users?.avatar_color || '#7C5CFF',
          initial: (p.users?.name || 'U')[0].toUpperCase(),
          user_id: p.user_id,
        })));
        if (user?.id) setJoined((data || []).some(p => p.user_id === user.id));
      });
  }, [spaceId, user?.id]);

  // Tick progress bar every 30s when space is live
  useEffect(() => {
    const tick = () => {
      const pct = calcSpaceProgress(sp?.time, sp?.day, sp?.duration);
      if (pct !== null) setProgress(pct);
    };
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [sp?.time, sp?.day, sp?.duration]);

  if (!sp) return (
    <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      <div style={{ fontSize:15, color:C.subtle }}>Loading space…</div>
    </div>
  );

  const count = (sp.participants || 0) + (joined ? 1 : 0);
  const maxSpots = sp.max_spots || sp.max || 10;
  const isFull = count >= maxSpots;
  const pct = Math.round((count / maxSpots) * 100);
  const liveProgress = calcSpaceProgress(sp.time, sp.day, sp.duration);
  const isLive = liveProgress !== null;
  const done = isLive && liveProgress >= 100;

  // Build participant list from DB, optionally prepend current user if joined but not yet in list
  const PARTICIPANTS = (() => {
    const list = [...realParticipants];
    return list;
  })();

  const ABOUT_SHORT = `${sp.desc || sp.description || ""}. A recurring space open to all skill levels — come alone or bring friends.`;
  const ABOUT_FULL  = `${sp.desc || sp.description || ""}. A recurring space open to all skill levels — come alone or bring friends. Hosted by ${sp.hostText || sp.host_text || "".replace('Created by ','').replace('Organized by ','')}, this space runs ${sp.time} for ${sp.duration} at ${sp.location}. All equipment is provided on site. Whether you're a beginner or experienced, everyone is welcome.`;

  const RULES = [
    'Respect other participants',
    'Arrive on time — late entries may not be permitted',
    'Appropriate attire required',
    'No food or drink in the activity area',
  ];

  const spCat = sp.cat || sp.category || 'social';
  const catColor = spCat === 'sports' ? 'linear-gradient(135deg,#10B981,#06B6D4)'
                 : spCat === 'academic' ? 'linear-gradient(135deg,#7C5CFF,#B06BFF)'
                 : spCat === 'social'   ? 'linear-gradient(135deg,#FF5A8A,#FF8A3D)'
                 : 'linear-gradient(135deg,#2F6BFF,#6C4DF2)';
  const spPrice = sp.is_free || sp.price === 0 || sp.price === 'Free' ? 'Free' : (sp.price ? `$${sp.price}` : 'Free');
  const fmtDur = v => v ? (/^\d+$/.test(String(v)) ? `${v} min` : String(v)) : '';
  const hostName = (sp.hostText || sp.host_text || '').replace(/^(Created by |Organized by )/i, '');

  // Compute date label from sp.day (could be 'today','tomorrow', or a date string like '2026-06-27')
  const spDayLabel = (() => {
    const raw = sp.day;
    if (!raw) return null;
    if (raw === 'today') return 'Today';
    if (raw === 'tomorrow') return 'Tomorrow';
    const spDate = new Date(raw + 'T00:00:00');
    if (isNaN(spDate)) return raw;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const tomorrowStr = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
    if (raw === todayStr) return 'Today';
    if (raw === tomorrowStr) return 'Tomorrow';
    return fmtDate(spDate);
  })();


  const HeaderBtn = ({ onClick, children }) => (
    <button onClick={onClick} style={{ width:38, height:38, border:'none', borderRadius:12,
      background:C.chip, display:'flex', alignItems:'center', justifyContent:'center',
      cursor:'pointer', flexShrink:0 }}>
      {children}
    </button>
  );

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      {/* ── Header ────────────────────────────────────────── */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)', backdropFilter:'blur(16px)',
                    padding:'50px 12px 12px', display:'flex', alignItems:'center', gap:7,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', zIndex:6 }}>
        <HeaderBtn onClick={goBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M14 6l-6 6 6 6" stroke={C.body} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </HeaderBtn>
        <div style={{ flex:1, textAlign:'center', fontSize:16, fontWeight:800,
                      letterSpacing:-0.4, color:C.ink, whiteSpace:'nowrap',
                      overflow:'hidden', textOverflow:'ellipsis' }}>{sp.title}</div>
        <HeaderBtn onClick={async () => {
          const shareData = { title: sp.title, text: `${sp.title} — ${spDayLabel || ''}${sp.time ? ' · ' + sp.time : ''}`, url: window.location.href };
          if (navigator.share) { try { await navigator.share(shareData); } catch {} }
          else { try { await navigator.clipboard.writeText(`${shareData.title}\n${shareData.text}\n${shareData.url}`); showToast('Space link copied to clipboard'); } catch { showToast('Could not share'); } }
        }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <circle cx="18" cy="5" r="3" stroke="#39414F" strokeWidth="1.8"/>
            <circle cx="6" cy="12" r="3" stroke="#39414F" strokeWidth="1.8"/>
            <circle cx="18" cy="19" r="3" stroke="#39414F" strokeWidth="1.8"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" stroke="#39414F" strokeWidth="1.8"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" stroke="#39414F" strokeWidth="1.8"/>
          </svg>
        </HeaderBtn>
        <HeaderBtn onClick={() => toggleSaveSpace && toggleSaveSpace(spaceId)}>
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z"
                  fill={spaceSaved?.[spaceId] ? C.primary : 'rgba(0,0,0,0)'}
                  stroke={spaceSaved?.[spaceId] ? C.primary : '#39414F'} strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
        </HeaderBtn>
        <HeaderBtn onClick={() => setLiked(v => !v)}>
          <svg width="17" height="17" viewBox="0 0 24 24">
            <path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7C20.5 15 12 20.5 12 20.5Z"
                  fill={liked ? '#FF3B6B' : 'rgba(0,0,0,0)'}
                  stroke={liked ? '#FF3B6B' : '#39414F'} strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
        </HeaderBtn>
      </div>

      {/* ── Body ─────────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', padding:'14px 16px 110px' }}>

        {/* Hero */}
        <div style={{ position:'relative', height:200, borderRadius:20, overflow:'hidden',
                      boxShadow:'0 10px 28px rgba(16,24,40,0.12)' }}>
          <div style={{ position:'absolute', inset:0, background:catColor }}/>
          {sp.image_url && <img src={sp.image_url} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>}
          <div style={{ position:'absolute', inset:0, background:
            'repeating-linear-gradient(135deg,rgba(255,255,255,0.08) 0,rgba(255,255,255,0.08) 2px,transparent 2px,transparent 16px)'}}/>
          <div style={{ position:'absolute', top:12, left:12, display:'inline-flex',
                        alignItems:'center', height:24, padding:'0 10px', borderRadius:999,
                        background:'rgba(255,255,255,0.92)', fontSize:12, fontWeight:700, color:C.body }}>
            {spCat.charAt(0).toUpperCase()+spCat.slice(1)} · Space
          </div>
          <div style={{ position:'absolute', top:'50%', left:'50%',
                        transform:'translate(-50%,-50%)', textAlign:'center' }}>
            <div style={{ fontSize:24, fontWeight:800, color:'#fff', letterSpacing:-0.5,
                          maxWidth:280, lineHeight:1.2, textShadow:'0 2px 8px rgba(0,0,0,0.25)' }}>{sp.title}</div>
          </div>
          <div style={{ position:'absolute', bottom:12, right:12, display:'inline-flex',
                        alignItems:'center', height:24, padding:'0 10px', borderRadius:7,
                        background:'rgba(14,23,38,0.55)', fontSize:12, fontWeight:700, color:'#fff' }}>
            {sp.time}{sp.duration ? ` · ${fmtDur(sp.duration)}` : ''}
          </div>
        </div>

        {/* Host card */}
        <div style={{ marginTop:13, background:C.card, borderRadius:16,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:'12px 15px',
                      display:'flex', alignItems:'center', gap:11, position:'relative' }}>
          <div style={{ width:44, height:44, borderRadius:'50%', flexShrink:0, overflow:'hidden',
                        background: sp.host_avatar ? 'transparent' : (sp.host_color || sp.avatar_color || 'linear-gradient(135deg,#19BFFF,#0098F0)'),
                        display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:18, fontWeight:800 }}>
            {sp.host_avatar
              ? <img src={sp.host_avatar} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
              : (hostName?.[0] || 'S').toUpperCase()}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:16, fontWeight:800, color:C.ink }}>{hostName || 'Organizer'}</div>
            <div style={{ fontSize:13, color:'#8A93A6', marginTop:2 }}>Space Host</div>
          </div>
          <div style={{ position:'relative', flexShrink:0 }}>
            <button onClick={() => setMoreOpen(v => !v)} style={{
              width:34, height:34, border:`1.5px solid ${C.border}`, borderRadius:999,
              background:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="5" cy="12" r="1.5" fill={C.muted}/><circle cx="12" cy="12" r="1.5" fill={C.muted}/><circle cx="19" cy="12" r="1.5" fill={C.muted}/>
              </svg>
            </button>
            {moreOpen && (
              <div style={{ position:'absolute', right:0, top:40, background:'#fff', borderRadius:12,
                            boxShadow:'0 8px 24px rgba(16,24,40,0.14)', border:`1px solid ${C.border}`,
                            zIndex:99, minWidth:130, overflow:'hidden' }}>
                <button onClick={async () => {
                  setMoreOpen(false);
                  if (!sp.host_id || !currentUser?.userId) { showToast('Sign in to message the host'); return; }
                  if (sp.host_id === currentUser.userId) { showToast("That's you!"); return; }
                  try {
                    const { data: chatId, error } = await supabase.rpc('create_direct_chat', { p_other_user_id: sp.host_id });
                    if (error || !chatId) { showToast('Failed to start chat'); return; }
                    navigate('chat', {
                      chatId,
                      chatName: hostName || 'Organizer',
                      chatInitial: (hostName || 'O')[0].toUpperCase(),
                      chatColor: sp.avatarColor || sp.avatar_color || 'linear-gradient(135deg,#19BFFF,#0098F0)',
                    });
                  } catch {
                    showToast('Failed to start chat');
                  }
                }} style={{
                  width:'100%', padding:'12px 16px', border:'none', background:'none',
                  textAlign:'left', fontSize:15, fontWeight:700, color:C.body,
                  cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
                  display:'flex', alignItems:'center', gap:8,
                }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                      stroke={C.primary} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Message
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Capacity card */}
        <div style={{ marginTop:13, background:C.card, borderRadius:16,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:15 }}>
          <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                            textTransform:'uppercase', color:C.subtle }}>Participants</div>
              <div style={{ fontSize:24, fontWeight:800, marginTop:3, lineHeight:1,
                            color: isFull ? '#FF3B6B' : C.ink }}>
                {count}/{sp.max_spots || sp.max || 10}{' '}
                <span style={{ fontSize:15, fontWeight:700, color:C.subtle }}>spots filled</span>
              </div>
            </div>
            <span style={{ fontSize:12, fontWeight:800, padding:'4px 10px', borderRadius:999,
                           background: isFull ? '#FDE7E4' : '#E6F8F0',
                           color: isFull ? C.danger : '#0E9F6E' }}>
              {isFull ? 'Full' : `${sp.max_spots || sp.max || 10 - count} left`}
            </span>
          </div>
          {/* Capacity bar */}
          <div style={{ height:8, borderRadius:999, background:'#EAEDF2', marginTop:12, overflow:'hidden' }}>
            <div style={{ height:'100%', borderRadius:999, transition:'width .4s ease',
                          width:`${pct}%`,
                          background: isFull ? '#FF3B6B' : 'linear-gradient(90deg,#19BFFF,#0098F0)' }}/>
          </div>
          {/* Avatar stack */}
          <div style={{ display:'flex', alignItems:'center', marginTop:12 }}>
            {PARTICIPANTS.slice(0, 6).map((p, i) => (
              <div key={i} style={{ width:30, height:30, borderRadius:'50%',
                                    marginLeft: i > 0 ? -8 : 0, border:'2.5px solid #fff',
                                    flexShrink:0, display:'flex', alignItems:'center',
                                    justifyContent:'center', color:'#fff', fontSize:12,
                                    fontWeight:800, background: p.avatar_url ? 'transparent' : p.color,
                                    overflow:'hidden' }}>
                {p.avatar_url
                  ? <img src={p.avatar_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                  : p.initial}
              </div>
            ))}
            {count > 6 && (
              <div style={{ width:30, height:30, borderRadius:'50%', marginLeft:-8,
                            border:'2.5px solid #fff', flexShrink:0, display:'flex',
                            alignItems:'center', justifyContent:'center',
                            background:C.chip, color:C.muted, fontSize:11, fontWeight:800 }}>
                +{count - 6}
              </div>
            )}
            <span style={{ fontSize:14, color:'#6B7385', marginLeft:10 }}>
              <span style={{ fontWeight:800, color:C.body }}>{count} joined</span>
              {' '}· {sp.max_spots || sp.max || 10 - count > 0 ? `${sp.max_spots || sp.max || 10 - count} spots left` : 'full'}
            </span>
          </div>

          {/* Live progress bar (only if session is currently in progress) */}
          {isLive && (
            <div style={{ marginTop:14, paddingTop:14, borderTop:`1px solid ${C.divider}` }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                            marginBottom:7 }}>
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <span style={{ position:'relative', width:9, height:9, display:'inline-flex',
                                 alignItems:'center', justifyContent:'center' }}>
                    <span style={{ position:'absolute', width:9, height:9, borderRadius:'50%',
                                   background:'#10B981', opacity:0.5,
                                   animation:'riplyPulse 1.6s ease-out infinite' }}/>
                    <span style={{ width:9, height:9, borderRadius:'50%', background:'#10B981' }}/>
                  </span>
                  <span style={{ fontSize:13, fontWeight:800, color:'#10B981', letterSpacing:0.2 }}>
                    {done ? 'ENDED' : 'IN PROGRESS'}
                  </span>
                </div>
                <span style={{ fontSize:13, fontWeight:700, color:C.subtle }}>
                  {done ? 'Completed' : `${liveProgress}%`}
                </span>
              </div>
              <div style={{ position:'relative', height:8, borderRadius:999, background:'#EAEDF2' }}>
                <div style={{ position:'absolute', left:0, top:0, bottom:0, borderRadius:999,
                              background:'linear-gradient(90deg,#34D399,#10B981)',
                              width:`${liveProgress}%`, transition:'width .7s linear' }}/>
                <div style={{ position:'absolute', top:'50%', transform:'translate(-50%,-50%)',
                              left:`${liveProgress}%`, width:14, height:14, borderRadius:'50%',
                              background:'#fff', border:'3px solid #10B981',
                              boxShadow:'0 2px 5px rgba(16,185,129,0.4)',
                              transition:'left .7s linear' }}/>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:7 }}>
                <span style={{ fontSize:12, fontWeight:600, color:C.subtle }}>Started {sp.time}</span>
                <span style={{ fontSize:12, fontWeight:600, color:C.subtle }}>
                  {sp.duration ? fmtDur(sp.duration) : ''}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Info card */}
        <div style={{ marginTop:13, background:C.card, borderRadius:16,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:'4px 15px' }}>
          {/* Schedule */}
          <div style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'13px 0',
                        borderBottom:`1px solid ${C.divider}` }}>
            <div style={{ width:36, height:36, borderRadius:10, flexShrink:0, background:'#E9F6FF',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke={C.primary} strokeWidth="1.9"/>
                <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                            textTransform:'uppercase', color:C.subtle }}>Schedule</div>
              <div style={{ fontSize:15, fontWeight:700, color:C.body, marginTop:3 }}>
                {spDayLabel}{sp.time ? ` · ${sp.time}` : ''}
              </div>
              <div style={{ fontSize:13, color:'#6B7385', marginTop:1 }}>{fmtDur(sp.duration)} session</div>
              <button onClick={() => addToCalendar({ title: sp.title, location: sp.location, description: sp.desc || sp.description, timeStr: sp.time, durationMins: sp.duration ? (parseInt(sp.duration) || 60) : 60 })} style={{
                marginTop:8, display:'inline-flex', alignItems:'center', gap:5,
                height:28, padding:'0 11px', border:`1.5px solid ${C.border}`, background:'#fff',
                borderRadius:999, fontSize:13, fontWeight:700, color:C.primary,
                cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M12 5v14M5 12h14" stroke={C.primary} strokeWidth="2.2" strokeLinecap="round"/>
                </svg>
                Add to Calendar
              </button>
            </div>
          </div>

          {/* Location */}
          <div style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'13px 0',
                        borderBottom:`1px solid ${C.divider}` }}>
            <div style={{ width:36, height:36, borderRadius:10, flexShrink:0, background:'#E9F6FF',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" stroke={C.primary} strokeWidth="1.9"/>
                <circle cx="12" cy="10" r="2.4" stroke={C.primary} strokeWidth="1.9"/>
              </svg>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                            textTransform:'uppercase', color:C.subtle }}>Location</div>
              <div style={{ fontSize:15, fontWeight:700, color:C.body, marginTop:3 }}>
                {sp.location}
              </div>
              {(() => {
                const addr = encodeURIComponent(sp.location || sp.title || '');
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${addr}`;
                const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${addr}`;
                return (
                  <>
                    <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                      style={{ display:'block', position:'relative', height:80, borderRadius:11,
                               overflow:'hidden', marginTop:10, textDecoration:'none',
                               background:'linear-gradient(135deg,#DCE7F0,#EDF2F7)', cursor:'pointer' }}>
                      <div style={{ position:'absolute', inset:0, background:
                        'repeating-linear-gradient(0deg,rgba(150,165,185,0.15) 0,rgba(150,165,185,0.15) 1px,transparent 1px,transparent 22px),repeating-linear-gradient(90deg,rgba(150,165,185,0.15) 0,rgba(150,165,185,0.15) 1px,transparent 1px,transparent 22px)'}}/>
                      <div style={{ position:'absolute', top:'42%', left:0, right:0, height:7, background:'rgba(255,255,255,0.6)' }}/>
                      <div style={{ position:'absolute', top:0, bottom:0, left:'40%', width:5, background:'rgba(255,255,255,0.5)' }}/>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                        style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-65%)' }}>
                        <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" fill={C.primary}/>
                        <circle cx="12" cy="10" r="2.6" fill="#fff"/>
                      </svg>
                      <div style={{ position:'absolute', bottom:6, right:8, background:'rgba(255,255,255,0.85)',
                        borderRadius:5, padding:'2px 6px', fontSize:11, fontWeight:700, color:C.primary }}>
                        Open Maps ↗
                      </div>
                    </a>
                    <div style={{ display:'flex', gap:8, marginTop:9 }}>
                      <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{
                        flex:1, height:32, border:`1.5px solid ${C.border}`, background:'#fff',
                        borderRadius:9, fontSize:13, fontWeight:700, color:C.body,
                        cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
                        display:'flex', alignItems:'center', justifyContent:'center', textDecoration:'none',
                      }}>View on Map</a>
                      <a href={directionsUrl} target="_blank" rel="noopener noreferrer" style={{
                        flex:1, height:32, border:'none', background:'#E9F6FF',
                        borderRadius:9, fontSize:13, fontWeight:700, color:C.primary,
                        cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
                        display:'flex', alignItems:'center', justifyContent:'center', textDecoration:'none',
                      }}>Get Directions</a>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Price */}
          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 0' }}>
            <div style={{ width:36, height:36, borderRadius:10, flexShrink:0,
                          background: spPrice === 'Free' ? '#E6F8F0' : '#FFF6E9',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              {spPrice === 'Free' ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke="#10B981" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="4" y1="20" x2="20" y2="4" stroke="#10B981" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                            textTransform:'uppercase', color:C.subtle }}>Price</div>
              <div style={{ fontSize:15, fontWeight:800, marginTop:3,
                            color: spPrice === 'Free' ? '#10B981' : '#F59E0B' }}>
                {spPrice}
                {spPrice !== 'Free' && <span style={{ fontSize:13, fontWeight:600, color:C.subtle }}> per session</span>}
              </div>
            </div>
          </div>
        </div>

        {/* About */}
        <div style={{ marginTop:13, background:C.card, borderRadius:16,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke={C.primary} strokeWidth="1.9"/>
              <path d="M12 11v5M12 8h.01" stroke={C.primary} strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize:16, fontWeight:800, color:C.ink }}>About This Space</span>
          </div>
          <div style={{ fontSize:14.5, lineHeight:1.65, color:C.muted }}>
            {expanded ? ABOUT_FULL : ABOUT_SHORT}
          </div>
          <button onClick={() => setExpanded(e => !e)} style={{ marginTop:8, border:'none',
            background:'none', padding:0, fontSize:14, fontWeight:800, color:C.primary,
            cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
            {expanded ? 'Show less' : 'Read more'}
          </button>
        </div>

        {/* Rules */}
        <div style={{ marginTop:13, background:C.card, borderRadius:16,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:11 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"
                    stroke={C.primary} strokeWidth="1.9" strokeLinejoin="round"/>
            </svg>
            <span style={{ fontSize:16, fontWeight:800, color:C.ink }}>Rules &amp; Guidelines</span>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
            {RULES.map((r, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:9 }}>
                <div style={{ width:20, height:20, borderRadius:'50%', flexShrink:0,
                              background:'#E6F8F0', display:'flex', alignItems:'center',
                              justifyContent:'center' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12.5l4.5 4.5L19 7" stroke="#10B981" strokeWidth="2.6"
                          strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span style={{ fontSize:14, fontWeight:600, color:'#3A4252' }}>{r}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* ── Floating join button ────────────────────────── */}
      <div style={{ position:'absolute', bottom:24, left:24, right:24, zIndex:6 }}>
        {done ? (
          <button disabled style={{ width:'100%', height:54, border:'none', borderRadius:18, cursor:'not-allowed', background:'#D1D5DB', color:'#6B7280', fontSize:17, fontWeight:800, fontFamily:"'Montserrat',-apple-system,sans-serif", display:'flex', alignItems:'center', justifyContent:'center' }}>
            Space Ended
          </button>
        ) : isFull && !joined ? (
          <button onClick={() => showToast("You'll be notified when a spot opens")} style={{
            width:'100%', height:54, border:'none', borderRadius:18, cursor:'pointer',
            background:C.subtle, color:'#fff', fontSize:17, fontWeight:800,
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            boxShadow:'0 10px 28px rgba(14,23,38,0.25)',
          }}>
            Notify When a Spot Opens
          </button>
        ) : (
          <button onClick={async () => {
            const next = !joined;
            setJoined(next);
            // Optimistically update avatar stack
            if (next) {
              const me = { avatar_url: currentUser?.avatarUrl || null, color: currentUser?.avatarColor || '#7C5CFF', initial: (currentUser?.name || user?.firstName || 'U')[0]?.toUpperCase() || 'U', user_id: user?.id };
              setRealParticipants(prev => prev.some(p => p.user_id === user?.id) ? prev : [me, ...prev]);
            } else {
              setRealParticipants(prev => prev.filter(p => p.user_id !== user?.id));
            }
            const isUuid = typeof sp.id === 'string' && sp.id.includes('-');
            if (user?.id && isUuid) {
              if (next) await supabase.from('space_participants').upsert({ space_id: sp.id, user_id: user.id });
              else await supabase.from('space_participants').delete().eq('space_id', sp.id).eq('user_id', user.id);
            }
          }} style={{
            width:'100%', height:54, borderRadius:18, cursor:'pointer',
            border: joined ? `1.6px solid #10B981` : 'none',
            background: joined ? '#E6F8F0' : C.grad,
            color: joined ? '#0E9F6E' : '#fff',
            fontSize:17, fontWeight:800,
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            boxShadow: joined ? 'none' : '0 10px 28px rgba(2,162,240,0.45)',
          }}>
            {joined ? "You're In · Joined ✓" : 'Join Space'}
            {!joined && <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SHEET: GIF PICKER (Giphy)
// ─────────────────────────────────────────────────────────────
function GifPickerSheet({ onClose, onSelect }) {
  const apiKey = import.meta.env.VITE_GIPHY_API_KEY;
  const [query,   setQuery]   = useState('');
  const [gifs,    setGifs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    if (!apiKey) { setLoading(false); setError(true); return; }
    let cancelled = false;
    const q = query.trim();
    setLoading(true);
    const endpoint = q
      ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=24&rating=pg-13`;
    // Debounce search-as-you-type; trending loads immediately.
    const timer = setTimeout(() => {
      fetch(endpoint)
        .then(res => {
          if (!res.ok) throw new Error(`Giphy request failed: ${res.status}`);
          return res.json();
        })
        .then(json => { if (!cancelled) { setGifs(json.data || []); setError(false); } })
        .catch(() => { if (!cancelled) setError(true); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, q ? 350 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, apiKey]);

  return (
    <Sheet onClose={onClose} title="Choose a GIF">
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search GIFs…"
        aria-label="Search GIFs"
        autoFocus
        style={{ width:'100%', height:42, border:'none', borderRadius:12, background:C.chip,
                 padding:'0 14px', fontSize:15, fontFamily:"'Montserrat',-apple-system,sans-serif",
                 color:C.body, outline:'none', marginBottom:14, boxSizing:'border-box' }}
      />
      {!apiKey ? (
        <div style={{ textAlign:'center', color:C.subtle, fontSize:15, padding:'30px 10px' }}>
          GIF search isn't configured yet.
        </div>
      ) : loading ? (
        <div style={{ textAlign:'center', color:C.subtle, fontSize:15, padding:'30px 10px' }}>Loading…</div>
      ) : error ? (
        <div style={{ textAlign:'center', color:C.subtle, fontSize:15, padding:'30px 10px' }}>Couldn't load GIFs -- try again.</div>
      ) : gifs.length === 0 ? (
        <div style={{ textAlign:'center', color:C.subtle, fontSize:15, padding:'30px 10px' }}>No GIFs found.</div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, maxHeight:340, overflowY:'auto' }}>
          {gifs.map(g => (
            <button key={g.id} onClick={() => onSelect(g.images.fixed_height.url)}
              aria-label={`Select GIF: ${g.title || g.id}`}
              style={{ border:'none', borderRadius:10, overflow:'hidden', padding:0, cursor:'pointer',
                       background:C.chip, aspectRatio:'1', display:'block' }}>
              <img src={g.images.fixed_height_small?.url || g.images.preview_gif?.url || g.images.fixed_height.url}
                alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: CHAT
// ─────────────────────────────────────────────────────────────
function ChatScreen({ chatId, chatName, chatInitial, chatColor, chatAvatarUrl, isGroup, goBack, showToast, currentUser }) {
  const found = CHATS.find(c => c.id === chatId);
  const chat = found || {
    id: chatId,
    name: chatName || 'Chat',
    initial: chatInitial || (chatName?.[0]?.toUpperCase() || '?'),
    color: chatColor || 'linear-gradient(135deg,#19BFFF,#0098F0)',
    avatarUrl: chatAvatarUrl || null,
    type: isGroup ? 'group' : 'dm',
  };

  const { messages: rawMessages, sendMessage, sendAttachment, currentUserId, notFound, resolveError, messagesError } = useChat(chatId)
  const [draft,       setDraft]       = useState('');
  const [menuOpen,    setMenuOpen]    = useState(false);
  // { kind: 'file', file: File } | { kind: 'gif', url: string } | null
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState(null);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [sending,     setSending]     = useState(false);
  const sendingRef = useRef(false);
  const scrollRef  = useRef(null);
  const inputRef   = useRef(null);
  const fileRef    = useRef(null);

  // Only image files get a visual preview; revoke the object URL whenever the
  // staged file changes or the screen unmounts, so we don't leak blob URLs.
  useEffect(() => {
    if (pendingAttachment?.kind !== 'file' || !pendingAttachment.file.type.startsWith('image/')) {
      setPendingPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingAttachment.file);
    setPendingPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingAttachment]);

  useEffect(() => {
    if (notFound) {
      showToast("Couldn't open that chat");
      goBack();
    }
  }, [notFound]);

  useEffect(() => {
    if (resolveError || messagesError) {
      showToast("Couldn't load chat -- check your connection and try again");
    }
  }, [resolveError, messagesError]);

  // Group chats have no single "other person" to fall back to, so an
  // unresolved profile shows as a generic member; DMs fall back to the
  // chat's own display name, which is already the other participant's name.
  const isGroupChat = chat.type === 'group' || chat.isGroup
  // Map Supabase shape → UI shape
  const messages = rawMessages.map(msg => {
    const isOut = msg.sender_id === currentUserId
    const profile = msg._senderProfile || null
    const senderName = isOut
      ? (currentUser?.name || profile?.name || 'You')
      : (profile?.name || (isGroupChat ? 'Member' : chatName) || '?')
    const senderAvatar = isOut ? (currentUser?.avatarUrl || profile?.avatar_url || null) : (profile?.avatar_url || null)
    const senderColor  = (isOut ? currentUser?.avatarColor : null) || profile?.avatar_color || 'linear-gradient(135deg,#7C5CFF,#02B6FE)'
    return {
      id:         msg.id,
      side:       isOut ? 'out' : 'in',
      text:       msg.content,
      time:       new Date(msg.created_at).toLocaleTimeString([], { hour:'numeric', minute:'2-digit', hour12:true }),
      hasText:    !!msg.content,
      hasImage:   !!(msg.attachment_url && /\.(png|jpe?g|gif|webp|heic)$/i.test(msg.attachment_url)),
      hasFile:    !!(msg.attachment_url && !/\.(png|jpe?g|gif|webp|heic)$/i.test(msg.attachment_url)),
      attachUrl:  msg.attachment_url || null,
      sender:     msg.sender_id,
      aName:      senderName,
      aInitial:   senderName[0]?.toUpperCase() || '?',
      aColor:     senderColor,
      aAvatar:    senderAvatar,
    }
  })

  const scrollTimerRef = useRef(null);
  const scrollToBottom = () => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, 40);
  };
  useEffect(() => () => {
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
  }, []);

  const send = async () => {
    const t = draft.trim();
    const attachment = pendingAttachment;
    if (!t && !attachment) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setDraft('');
    setPendingAttachment(null);
    try {
      const err = !attachment ? await sendMessage(t)
        : attachment.kind === 'file' ? await sendAttachment(attachment.file, t)
        : await sendMessage(t, attachment.url);
      if (err) throw err;
    } catch {
      setDraft(current => (current && current !== t) ? `${t} ${current}`.trim() : t);
      setPendingAttachment(current => current || attachment);
      showToast("Couldn't send -- try again");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  // Auto-scroll when messages change
  useEffect(() => { scrollToBottom(); }, [rawMessages]);

  // Online status — group chats (id 4) show member count, DMs show 'Active recently'.
  // Groups and a currently-online DM read as "active now" (blue, matches the
  // app's theme color); a last-seen/recency label reads as grey since it's
  // not a live state.
  const memberCount = chat.memberCount || chat.members;
  const isActiveNow = isGroupChat;
  const onlineLabel = isGroupChat
    ? memberCount ? `Online · ${memberCount} members` : 'Online'
    : 'Active recently';
  const statusColor = isActiveNow ? C.primary : C.subtle;

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background:C.pageBg,
                  fontFamily:"'Montserrat',-apple-system,sans-serif", position:'relative' }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)', backdropFilter:'blur(16px)',
                    padding:'50px 13px 12px', display:'flex', alignItems:'center', gap:10,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', zIndex:6 }}>
        <button onClick={goBack} style={{ width:38, height:38, border:'none', borderRadius:12,
          background:C.chip, display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M14 6l-6 6 6 6" stroke={C.body} strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Name + status */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:16, fontWeight:800, letterSpacing:-0.3, color:C.ink,
                        whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {chat.name}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:1 }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:statusColor,
                           display:'inline-block', flexShrink:0 }}/>
            <span style={{ fontSize:13, fontWeight:600, color:statusColor }}>{onlineLabel}</span>
          </div>
        </div>

        {/* Avatar */}
        <div style={{ width:40, height:40, borderRadius:'50%', flexShrink:0,
                      background: chat.avatarUrl ? 'transparent' : chat.color, display:'flex', alignItems:'center',
                      justifyContent:'center', color:'#fff', fontSize:15, fontWeight:800,
                      position:'relative', overflow:'hidden' }}>
          {chat.avatarUrl
            ? <img src={chat.avatarUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
            : <><span>{chat.initial}</span>
                <div style={{ position:'absolute', inset:0, background:
                  'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 11px)' }}/>
              </>
          }
          {/* online dot */}
          <div style={{ position:'absolute', bottom:1, right:1, width:9, height:9,
                        borderRadius:'50%', background:'#10B981',
                        border:'2px solid #fff' }}/>
        </div>

        {/* Action icons */}
        <button onClick={() => setMenuOpen(v => !v)} style={{ width:32, height:36, border:'none',
          background:'none', display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="5"  r="1.8" fill="#39414F"/>
            <circle cx="12" cy="12" r="1.8" fill="#39414F"/>
            <circle cx="12" cy="19" r="1.8" fill="#39414F"/>
          </svg>
        </button>

        {/* Dropdown menu */}
        {menuOpen && (
          <div style={{ position:'absolute', top:56, right:13, background:C.card,
                        borderRadius:14, boxShadow:'0 8px 24px rgba(16,24,40,0.14)',
                        overflow:'hidden', zIndex:20, minWidth:170 }}>
            {['View Profile','Mute Notifications','Search in Chat','Clear Chat','Block'].map((item,i) => (
              <div key={item} onClick={()=>{ setMenuOpen(false); showToast(item); }}
                style={{ padding:'13px 16px', fontSize:15, fontWeight:600,
                         color: item==='Block' ? C.danger : C.body,
                         borderBottom: i<4 ? `1px solid ${C.divider}` : 'none',
                         cursor:'pointer', background:C.card }}>
                {item}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tap outside menu to close */}
      {menuOpen && (
        <div onClick={()=>setMenuOpen(false)}
          style={{ position:'absolute', inset:0, zIndex:19 }}/>
      )}

      {/* ── Message list ───────────────────────────────────── */}
      <div ref={scrollRef} style={{ flex:1, overflowY:'auto', padding:'14px 13px 12px',
                                     display:'flex', flexDirection:'column', gap:3 }}>
        {/* Date pill */}
        <div style={{ alignSelf:'center', margin:'4px 0 10px', padding:'4px 12px',
                      borderRadius:999, background:'rgba(16,24,40,0.06)',
                      fontSize:12, fontWeight:700, color:'#7B8499' }}>
          Today
        </div>

        {messages.map((m, i) => {
          const isOut = m.side === 'out';
          const prev  = messages[i - 1];
          const firstOfGroup = !prev || prev.side !== m.side ||
            (!isOut && isGroupChat && prev.sender !== m.sender);

          return (
            <div key={m.id} style={{ display:'flex', gap:7, marginTop: firstOfGroup ? 10 : 2,
                                      flexDirection: isOut ? 'row-reverse' : 'row' }}>
              {/* Avatar — only first of incoming group */}
              {!isOut && firstOfGroup && (
                <div style={{ width:28, height:28, borderRadius:'50%', flexShrink:0,
                              background: m.aAvatar ? 'transparent' : m.aColor, display:'flex', alignItems:'center',
                              justifyContent:'center', color:'#fff', fontSize:12,
                              fontWeight:800, alignSelf:'flex-start', position:'relative',
                              overflow:'hidden' }}>
                  {m.aAvatar
                    ? <img src={m.aAvatar} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
                    : <><span>{m.aInitial}</span>
                      <div style={{ position:'absolute', inset:0, background:
                        'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 10px)' }}/></>
                  }
                </div>
              )}
              {/* Spacer for subsequent messages in group */}
              {!isOut && !firstOfGroup && <div style={{ width:28, flexShrink:0 }}/>}

              <div style={{ display:'flex', flexDirection:'column', maxWidth:'74%',
                            alignItems: isOut ? 'flex-end' : 'flex-start' }}>
                {/* Sender name */}
                {!isOut && firstOfGroup && (
                  <span style={{ fontSize:12, fontWeight:700, color:'#8A93A6',
                                 marginBottom:3, marginLeft:4 }}>{m.aName}</span>
                )}

                {/* Bubble -- an image-only message (no caption text) drops the
                    colored chip background/padding so the photo shows on its
                    own with no border chrome around it. */}
                <div style={{
                  background: (m.hasImage && !m.hasText) ? 'transparent' : (isOut ? 'linear-gradient(135deg,#19BFFF,#0090F0)' : '#fff'),
                  padding: (m.hasImage && !m.hasText) ? 0 : '9px 13px',
                  borderRadius: isOut ? '17px 17px 4px 17px' : '17px 17px 17px 4px',
                  boxShadow: (m.hasImage && !m.hasText) ? 'none' : (isOut
                    ? '0 3px 10px rgba(2,162,240,0.28)'
                    : '0 2px 8px rgba(16,24,40,0.07)'),
                }}>
                  {/* Image attachment */}
                  {m.hasImage && (
                    <div style={{ borderRadius:11, overflow:'hidden', marginBottom: m.hasText ? 7 : 0, maxWidth:220 }}>
                      <img src={m.attachUrl} alt="attachment"
                        style={{ width:'100%', display:'block', borderRadius:11 }}
                        onClick={() => window.open(m.attachUrl, '_blank')}
                      />
                    </div>
                  )}
                  {/* File attachment */}
                  {m.hasFile && (
                    <a href={m.attachUrl} target="_blank" rel="noreferrer"
                      style={{ display:'flex', alignItems:'center', gap:8, marginBottom: m.hasText ? 7 : 0,
                               background: isOut ? 'rgba(255,255,255,0.15)' : C.chip,
                               borderRadius:10, padding:'8px 11px', textDecoration:'none' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" stroke={isOut?'#fff':'#7B8499'} strokeWidth="1.8" strokeLinejoin="round"/>
                        <path d="M14 2v6h6" stroke={isOut?'#fff':'#7B8499'} strokeWidth="1.8" strokeLinejoin="round"/>
                      </svg>
                      <span style={{ fontSize:13, fontWeight:700, color: isOut ? '#fff' : C.body,
                                     whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:140 }}>
                        {m.attachUrl?.split('/').pop() || 'File'}
                      </span>
                    </a>
                  )}
                  {/* Text */}
                  {m.hasText && (
                    <span style={{ fontSize:15, lineHeight:1.47,
                                   color: isOut ? '#fff' : '#1A2233' }}>
                      {m.text}
                    </span>
                  )}
                </div>

                {/* Timestamp -- a WhatsApp-style check only appears on the
                    very last message when it's ours (sent/delivered), never
                    on an incoming one, so it reads as "seen up to here". */}
                <span style={{ display:'flex', alignItems:'center', gap:3,
                               marginTop:4, marginLeft:4,
                               alignSelf: isOut ? 'flex-end' : 'flex-start' }}>
                  <span style={{ fontSize:11.5, color:C.subtle, fontWeight:600 }}>{m.time}</span>
                  {isOut && i === messages.length - 1 && (
                    <svg width="14" height="10" viewBox="0 0 16 11" fill="none">
                      <path d="M1 5.5 4.5 9 11 1.5" stroke={C.primary} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M5.5 5.5 9 9 15.5 1.5" stroke={C.primary} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Composer ───────────────────────────────────────── */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)',
                    backdropFilter:'blur(16px)',
                    boxShadow:'0 -1px 0 rgba(16,24,40,0.07)',
                    padding:'10px 13px 26px', zIndex:6 }}>
        {/* Staged attachment preview */}
        {pendingAttachment && (
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:9 }}>
            <div style={{ width:44, height:44, borderRadius:10, overflow:'hidden', flexShrink:0,
                          background:C.chip, display:'flex', alignItems:'center', justifyContent:'center' }}>
              {pendingAttachment.kind === 'gif' ? (
                <img src={pendingAttachment.url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
              ) : pendingPreviewUrl ? (
                <img src={pendingPreviewUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" stroke="#7B8499" strokeWidth="1.8" strokeLinejoin="round"/>
                  <path d="M14 2v6h6" stroke="#7B8499" strokeWidth="1.8" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:700, color:C.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                {pendingAttachment.kind === 'gif' ? 'GIF' : pendingAttachment.file.name}
              </div>
              {pendingAttachment.kind === 'file' && (
                <div style={{ fontSize:12.5, color:C.subtle, marginTop:1 }}>
                  {(pendingAttachment.file.size / 1024).toFixed(0)} KB
                </div>
              )}
            </div>
            <button onClick={() => setPendingAttachment(null)} style={{ width:26, height:26, border:'none',
              borderRadius:'50%', background:C.chip, display:'flex', alignItems:'center',
              justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M18 6 6 18M6 6l12 12" stroke="#7B8499" strokeWidth="2.2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        )}

        <div style={{ display:'flex', alignItems:'center', gap:7 }}>
          {/* Hidden file input */}
          <input ref={fileRef} type="file" accept="image/*,application/pdf,.doc,.docx,.txt"
            style={{ display:'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setPendingAttachment({ kind:'file', file });
            }}
          />
          {/* Attach */}
          <button onClick={() => fileRef.current?.click()} style={{ width:36, height:36,
            border:'none', background:'none', display:'flex', alignItems:'center',
            justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M20 11.5 12.5 19a4.5 4.5 0 0 1-6.4-6.4l7.6-7.6a3 3 0 0 1 4.3 4.3l-7.6 7.6a1.5 1.5 0 0 1-2.2-2.2l6.9-6.9"
                    stroke="#7B8499" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* GIF */}
          <button onClick={() => setGifPickerOpen(true)} style={{ height:32, padding:'0 9px',
            border:'none', borderRadius:9, background:C.chip, display:'flex', alignItems:'center',
            justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
            <span style={{ fontSize:13, fontWeight:800, color:'#7B8499', letterSpacing:0.2 }}>GIF</span>
          </button>

          {/* Input pill */}
          <div style={{ flex:1, display:'flex', alignItems:'center', background:C.chip,
                        borderRadius:999, padding:'0 15px', height:44,
                        boxShadow:'inset 0 0 0 1px rgba(16,24,40,0.04)' }}>
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
              placeholder={pendingAttachment ? 'Add a caption…' : 'Type a message…'}
              style={{ flex:1, minWidth:0, border:'none', background:'none', outline:'none',
                       fontFamily:"'Montserrat',-apple-system,sans-serif",
                       fontSize:15, color:C.body }}
            />
          </div>

          {/* Send -- no mic/recording placeholder, since voice messages aren't
              actually implemented; the button did nothing but show a toast. */}
          <button onClick={send} disabled={sending || (!draft.trim() && !pendingAttachment)} style={{ width:44, height:44, border:'none', borderRadius:'50%',
            background:C.grad, display:'flex', alignItems:'center', justifyContent:'center',
            cursor: sending ? 'default' : 'pointer', flexShrink:0,
            opacity: (sending || (!draft.trim() && !pendingAttachment)) ? 0.5 : 1,
            boxShadow:'0 4px 12px rgba(2,162,240,0.4)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M22 2 11 13" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M22 2 15 22l-4-9-9-4 20-7Z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      {gifPickerOpen && (
        <GifPickerSheet
          onClose={() => setGifPickerOpen(false)}
          onSelect={(url) => { setPendingAttachment({ kind:'gif', url }); setGifPickerOpen(false); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// COMPONENT: CHANGE PASSWORD
// ─────────────────────────────────────────────────────────────
function ChangePasswordSheet({ onClose, showToast, chipBg, borderColor, textColor, subColor }) {
  const { user } = useUser();
  const [currentPw, setCurrentPw] = useState('');
  const [newPw,     setNewPw]     = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading,   setLoading]   = useState(false);

  const handleUpdate = async () => {
    if (!newPw || newPw.length < 8) { showToast('New password must be at least 8 characters'); return; }
    if (newPw !== confirmPw) { showToast("Passwords don't match"); return; }
    if (!currentPw) { showToast('Enter your current password'); return; }
    setLoading(true);
    try {
      await user.updatePassword({ currentPassword: currentPw, newPassword: newPw });
      showToast('Password updated successfully');
      onClose();
    } catch (err) {
      showToast(err?.errors?.[0]?.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { width:'100%', boxSizing:'border-box', height:48, border:`1.5px solid ${borderColor}`, borderRadius:14, background:chipBg, padding:'0 14px', fontSize:15, fontWeight:700, color:textColor, outline:'none', fontFamily:"'Montserrat',-apple-system,sans-serif" };
  const labelStyle = { fontSize:11, fontWeight:700, letterSpacing:0.4, textTransform:'uppercase', color:subColor, marginBottom:7 };

  return (
    <Sheet onClose={onClose} title="Change Password">
      <div style={{ marginBottom:14 }}>
        <div style={labelStyle}>Current Password</div>
        <input type="password" value={currentPw} onChange={e=>setCurrentPw(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom:14 }}>
        <div style={labelStyle}>New Password</div>
        <input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginBottom:14 }}>
        <div style={labelStyle}>Confirm Password</div>
        <input type="password" value={confirmPw} onChange={e=>setConfirmPw(e.target.value)} style={inputStyle} />
      </div>
      <button onClick={handleUpdate} disabled={loading} style={{ width:'100%', height:52, marginTop:6, border:'none', borderRadius:15, background: loading ? C.border : C.grad, color:'#fff', fontSize:16, fontWeight:800, cursor: loading ? 'default' : 'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", boxShadow: loading ? 'none' : '0 8px 20px rgba(2,162,240,0.4)' }}>
        {loading ? 'Updating…' : 'Update Password'}
      </button>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────
// COMPONENT: CHANGE EMAIL
// ─────────────────────────────────────────────────────────────
// Actually updates the Clerk auth email (the one used to sign in), not just
// the app's own copy in the `users` table -- that copy alone was never wired
// to anything real. Clerk requires a new email address to be verified by
// code before it can become primary, so this is a two-step sheet: enter the
// new address, then enter the code sent to it.
function ChangeEmailSheet({ onClose, showToast, currentUser, chipBg, borderColor, textColor, subColor }) {
  const { user } = useUser();
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const pendingEmailRef = useRef(null);

  const sendCode = async () => {
    const email = newEmail.trim();
    if (!email.includes('@')) { showToast('Enter a valid email'); return; }
    if (email.toLowerCase() === (currentUser.email || '').toLowerCase()) { showToast('That\'s already your email'); return; }
    setLoading(true);
    try {
      const emailAddress = await user.createEmailAddress({ email });
      await emailAddress.prepareVerification({ strategy: 'email_code' });
      pendingEmailRef.current = emailAddress;
      setStep('code');
    } catch (err) {
      showToast(err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || 'Could not start email change');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!code || code.length < 6) { showToast('Enter the full 6-digit code'); return; }
    const emailAddress = pendingEmailRef.current;
    if (!emailAddress) { showToast('Session expired -- start again'); setStep('email'); return; }
    setLoading(true);
    try {
      const result = await emailAddress.attemptVerification({ code });
      if (result.verification?.status !== 'verified') {
        showToast('Invalid or expired code. Try again.');
        return;
      }
      // Old email address objects (if any, beyond the new one) become
      // orphaned once a different one is primary -- Clerk keeps them around
      // as secondary addresses otherwise, which would let sign-in with the
      // old address keep working after the user meant to replace it.
      const oldAddresses = user.emailAddresses.filter(e => e.id !== emailAddress.id);
      await user.update({ primaryEmailAddressId: emailAddress.id });
      await Promise.all(oldAddresses.map(e => e.destroy().catch(() => {})));
      await currentUser.updateProfile({ email: emailAddress.emailAddress });
      showToast('Email updated ✓');
      onClose();
    } catch (err) {
      showToast(err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || 'Invalid code. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { width:'100%', boxSizing:'border-box', height:50, border:`1.5px solid ${borderColor}`, borderRadius:14, background:chipBg, padding:'0 14px', fontSize:17, fontWeight:700, color:textColor, outline:'none', fontFamily:"'Montserrat',-apple-system,sans-serif" };
  const labelStyle = { fontSize:13, fontWeight:700, letterSpacing:0.4, textTransform:'uppercase', color:subColor, marginBottom:7 };

  return (
    <Sheet onClose={onClose} title="Change Email">
      {step === 'email' ? (
        <>
          <div style={{ fontSize:14, color:subColor, marginBottom:16, lineHeight:1.5 }}>
            Current email: <span style={{ fontWeight:700, color:textColor }}>{currentUser.email || '—'}</span>
          </div>
          <div style={{ marginBottom:14 }}>
            <div style={labelStyle}>New Email</div>
            <input type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} />
          </div>
          <button onClick={sendCode} disabled={loading} style={{ width:'100%', height:54, marginTop:6, border:'none', borderRadius:15, background: loading ? C.border : C.grad, color:'#fff', fontSize:18, fontWeight:800, cursor: loading ? 'default' : 'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", boxShadow: loading ? 'none' : '0 8px 20px rgba(2,162,240,0.4)' }}>
            {loading ? 'Sending…' : 'Send Verification Code'}
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize:14, color:subColor, marginBottom:16, lineHeight:1.5 }}>
            Enter the code we sent to <span style={{ fontWeight:700, color:textColor }}>{newEmail.trim()}</span>
          </div>
          <div style={{ marginBottom:14 }}>
            <div style={labelStyle}>Verification Code</div>
            <input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} inputMode="numeric" maxLength={6} placeholder="123456" style={inputStyle} />
          </div>
          <button onClick={verifyCode} disabled={loading} style={{ width:'100%', height:54, marginTop:6, border:'none', borderRadius:15, background: loading ? C.border : C.grad, color:'#fff', fontSize:18, fontWeight:800, cursor: loading ? 'default' : 'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", boxShadow: loading ? 'none' : '0 8px 20px rgba(2,162,240,0.4)' }}>
            {loading ? 'Verifying…' : 'Verify & Save'}
          </button>
          <button onClick={()=>{ setStep('email'); setCode(''); }} disabled={loading} style={{ width:'100%', height:44, marginTop:10, border:'none', background:'none', color:subColor, fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
            Use a different email
          </button>
        </>
      )}
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: PROFILE
// ─────────────────────────────────────────────────────────────
function ProfileScreen({ navigate, showToast, currentUser, saved }) {
  const cu = currentUser || {};
  const scrollRef = useRef(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = profileScrollTop; }, []);
  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [push, setPush] = useState(() => {
    if (typeof Notification === 'undefined') return false;
    return Notification.permission === 'granted';
  });
  const [emailNotif, setEmailNotif] = useState(() => localStorage.getItem('pref_email_notif') === 'true');
  const [reminders, setReminders] = useState(() => localStorage.getItem('pref_reminders') !== 'false');
  const [location, setLocation] = useState(() => localStorage.getItem('pref_location') !== 'false');
  const [privateProfile, setPrivateProfile] = useState(() => localStorage.getItem('pref_private') === 'true');
  const [payOpen, setPayOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({ events: 0, groups: 0, spaces: 0 });

  useEffect(() => {
    if (!cu?.userId) return;
    Promise.all([
      supabase.from('tickets').select('event_id', { count: 'exact', head: true }).eq('user_id', cu.userId),
      supabase.from('group_members').select('group_id', { count: 'exact', head: true }).eq('user_id', cu.userId),
      supabase.from('space_participants').select('space_id', { count: 'exact', head: true }).eq('user_id', cu.userId),
    ]).then(([rsvps, grps, spaces]) => {
      setStats({ events: rsvps.count || 0, groups: grps.count || 0, spaces: spaces.count || 0 });
    });
  }, [cu?.userId]);

  const name = cu.name || 'Student';
  const email = cu.email || '';
  const [profileRole, setProfileRole] = useState(cu.role || 'student');
  const [draftName, setDraftName] = useState('');
  const [draftUniversity, setDraftUniversity] = useState('');
  const [draftYear, setDraftYear] = useState('');
  const [draftProgram, setDraftProgram] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const pageBg = C.pageBg;
  const cardBg = C.card;
  const textColor = C.ink;
  const subColor = C.muted;
  const chipBg = C.chip;
  const borderColor = C.border;
  const iconStroke = '#39414F';

  const roleConfig = {
    student: { color:'#0098F0', bg:'#E9F6FF', label:'Student' },
    organizer: { color:'#7C5CFF', bg:'#F1ECFF', label:'Event Organizer' },
    admin: { color:'#15A34A', bg:'#E4F7EC', label:'Group Admin' },
  };
  const rc = roleConfig[profileRole] || roleConfig.student;
  const initials = name ? name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase() : '?';

  const SETTINGS_GROUPS = [
    {
      title:'Account',
      rows: [
        { icon:'#E9F6FF', iconStroke:C.primary, iconPath:'M5 19h3l9-9-3-3-9 9v3Z', iconPath2:'m14.5 6.5 3 3', title:'Edit Profile', hasChevron:true, onClick:()=>{ setDraftName(currentUser.name||''); setDraftUniversity(currentUser.university||''); setDraftYear(currentUser.year||''); setDraftProgram(currentUser.program||''); setEditOpen(true); } },
        { icon:'#FFF6E9', iconStroke:'#F59E0B', iconPath:'M4 8.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 1.8 1.8 0 0 0 0 3.4 1.8 1.8 0 0 0 0 3.6 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 1.8 1.8 0 0 0 0-3.6 1.8 1.8 0 0 0 0-3.4Z', iconPath2:'M14 7.5v9', iconPath2Dash:true, title:'My Tickets', hasChevron:true, onClick:()=>navigate('my-tickets') },
        { icon:'#E9F6FF', iconStroke:C.primary, iconPath:'M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z', title:'Saved', hasChevron:true, onClick:()=>navigate('saved-events') },
        { icon:'#F1ECFF', iconStroke:'#7C5CFF', iconPath:'M3 6.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11Z', iconPath2:'M3 10h18M6.5 15h1.5', iconPath2Dash:false, title:'Payment Methods', hasChevron:true, onClick:()=>setPayOpen(true) },
        ...(profileRole!=='student'?[{ icon:'#E9F6FF', iconStroke:C.primary, iconPath:'M3 5h18M3 10h18M3 15h10', title:'Manage Events', hasChevron:true, onClick:()=>navigate('event-manager') }]:[]),
      ],
    },
    {
      title:'Preferences',
      rows: [
        { icon:'#E9F6FF', iconStroke:C.primary, iconPath:'M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5Z', title:'Push Notifications', isToggle:true, toggleVal:push, onToggle: async () => {
          if (push) {
            setPush(false);
            showToast('Push notifications disabled');
            return;
          }
          if (typeof Notification === 'undefined') { showToast('Notifications not supported on this device'); return; }
          if (Notification.permission === 'denied') {
            showToast('Notifications blocked — enable them in your browser settings');
            return;
          }
          if (!import.meta.env.VITE_FIREBASE_API_KEY) { showToast('Firebase not configured'); return; }
          const { requestNotificationPermission } = await import('./lib/firebase.js');
          const token = await requestNotificationPermission(currentUser?.userId);
          if (token) { setPush(true); showToast('Push notifications enabled!'); }
          else { showToast('Could not enable notifications — please try again'); }
        }},
        { icon:'#E4F7EC', iconStroke:'#15A34A', iconPath:'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z', iconPath2:'m22 6-10 7L2 6', title:'Email Notifications', isToggle:true, toggleVal:emailNotif, onToggle:()=>{ const v=!emailNotif; setEmailNotif(v); localStorage.setItem('pref_email_notif', v); showToast(v ? 'Email notifications enabled' : 'Email notifications disabled'); } },
        { icon:'#FFF6E9', iconStroke:'#F59E0B', iconPath:'M12 2L15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z', title:'Reminders', isToggle:true, toggleVal:reminders, onToggle:()=>{ const v=!reminders; setReminders(v); localStorage.setItem('pref_reminders', v); showToast(v ? 'Reminders enabled' : 'Reminders disabled'); } },
        { icon:'#FDE7E4', iconStroke:C.danger, iconPath:'M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z', iconPath2:'', title:'Location Services', isToggle:true, toggleVal:location, onToggle:()=>{
          const v=!location;
          if (!v) { setLocation(false); localStorage.setItem('pref_location','false'); showToast('Location disabled'); return; }
          if (!navigator.geolocation) { showToast('Location services are not available on this device'); return; }
          navigator.geolocation.getCurrentPosition(
            ()=>{ setLocation(true); localStorage.setItem('pref_location','true'); showToast('Location enabled'); },
            ()=>showToast('Location permission denied'),
          );
        } },
      ],
    },
    {
      title:'Privacy & Security',
      rows: [
        { icon:'#F1F3F7', iconStroke:C.muted, iconPath:'M12 1a5 5 0 0 1 5 5v3h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h1V6a5 5 0 0 1 5-5z', title:'Private Profile', isToggle:true, toggleVal:privateProfile, onToggle: async ()=>{ const v=!privateProfile; setPrivateProfile(v); localStorage.setItem('pref_private',v); await currentUser.updateProfile({ private: v }); showToast(v ? 'Profile set to private' : 'Profile set to public'); } },
        { icon:'#FDE7E4', iconStroke:C.danger, iconPath:'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4', title:'Change Password', hasChevron:true, onClick:()=>setPwOpen(true) },
        { icon:'#E4F7EC', iconStroke:'#15A34A', iconPath:'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z', iconPath2:'m22 6-10 7L2 6', title:'Change Email', hasChevron:true, onClick:()=>setEmailOpen(true) },
      ],
    },
    {
      title:'Support',
      rows: [
        { icon:'#E9F6FF', iconStroke:C.primary, iconPath:'M12 22C17.523 22 22 17.523 22 12S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z', iconPath2:'M12 8v4m0 4h.01', title:'Help Center', hasChevron:true, onClick:()=>navigate('help-center') },
        { icon:'#E4F7EC', iconStroke:'#15A34A', iconPath:'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', title:'Send Feedback', hasChevron:true, onClick:()=>navigate('feedback') },
        { icon:'#F1F3F7', iconStroke:C.muted, iconPath:'M12 22C17.523 22 22 17.523 22 12S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z', title:'About Riply', hasChevron:true, onClick:()=>navigate('about') },
      ],
    },
  ];

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative', background:pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif", transition:'background .3s' }}>
      {/* Header */}
      <div style={{ flexShrink:0, background:cardBg, padding:'52px 16px 10px', boxShadow:'0 1px 0 rgba(16,24,40,0.04)', zIndex:4, transition:'background .3s' }}>
        <span style={{ fontSize:24, fontWeight:800, letterSpacing:-0.6, color:textColor }}>Profile & Settings</span>
      </div>

      {/* Content */}
      <div ref={scrollRef} onScroll={e => { profileScrollTop = e.currentTarget.scrollTop; }}
        style={{ flex:1, overflowY:'auto', padding:'22px 16px 104px' }}>
        {/* Identity */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center' }}>
          <button onClick={() => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*';
            input.onchange = async (e) => {
              const file = e.target.files[0]; if (!file) return;
              setUploadingPhoto(true);
              try {
                const url = await uploadImage(file, 'post-media', `avatars/${currentUser.userId}.jpg`);
                const { error } = await currentUser.updateProfile({ avatar_url: url });
                if (error) showToast('Save failed: ' + error.message);
                else showToast('Profile photo updated ✓');
              } catch(err) { showToast('Upload failed: ' + err.message); }
              finally { setUploadingPhoto(false); }
            };
            input.click();
          }} style={{ width:96, height:96, borderRadius:'50%', padding:3, background:C.grad, boxShadow:'0 8px 20px rgba(2,162,240,0.35)', position:'relative', border:'none', cursor:'pointer', opacity: uploadingPhoto ? 0.6 : 1 }}>
            <div style={{ width:'100%', height:'100%', borderRadius:'50%', background: currentUser.avatarColor || 'linear-gradient(135deg,#FF8A3D,#FF5A8A)', display:'flex', alignItems:'center', justifyContent:'center', border:`3px solid ${cardBg}`, position:'relative', overflow:'hidden' }}>
              {currentUser.avatarUrl
                ? <img src={currentUser.avatarUrl} alt="avatar" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                : <><div style={{ position:'absolute', inset:0, background:'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 12px)' }} />
                    <span style={{ fontSize:30, fontWeight:800, color:'#fff', letterSpacing:-1 }}>{initials}</span></>
              }
            </div>
            <div style={{ position:'absolute', bottom:4, right:4, width:26, height:26, borderRadius:'50%', background:C.primary, display:'flex', alignItems:'center', justifyContent:'center', border:`2px solid ${cardBg}` }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 19h3l9-9-3-3-9 9v3Z" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/></svg>
            </div>
          </button>
          <div style={{ fontSize:21, fontWeight:800, letterSpacing:-0.5, color:textColor, marginTop:13 }}>{name}</div>
          <div style={{ display:'flex', alignItems:'center', gap:7, marginTop:7, flexWrap:'wrap', justifyContent:'center' }}>
            <div style={{ display:'inline-flex', alignItems:'center', height:24, padding:'0 11px', borderRadius:999, background:'#E9F6FF', fontSize:11.5, fontWeight:700, color:C.primary }}>{[currentUser.year, currentUser.program].filter(Boolean).join(' · ') || currentUser.university || 'Student'}</div>
            <button onClick={()=>setRoleOpen(r=>!r)} style={{ display:'inline-flex', alignItems:'center', gap:5, height:24, padding:'0 11px', border:'none', borderRadius:999, background:rc.bg, fontSize:11.5, fontWeight:800, color:rc.color, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
              {rc.label}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d={`m6 9 6 6 6-6`} stroke={rc.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
          {roleOpen && (
            <div style={{ background:cardBg, borderRadius:14, boxShadow:'0 8px 24px rgba(16,24,40,0.16)', overflow:'hidden', marginTop:9, width:200 }}>
              {Object.entries(roleConfig).map(([k,v]) => (
                <button key={k} onClick={async ()=>{ setRoleOpen(false); const {error}=await currentUser.updateProfile({role:k}); if(error) showToast('Failed to update role'); else showToast(`Role updated to ${v.label}`); }} style={{ display:'flex', width:'100%', padding:'12px 16px', border:'none', background: profileRole===k?v.bg:'none', cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", fontSize:13.5, fontWeight:800, color: profileRole===k?v.color:textColor, textAlign:'left', alignItems:'center', justifyContent:'space-between' }}>
                  {v.label}
                  {profileRole===k && <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4 4L19 7" stroke={v.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </button>
              ))}
            </div>
          )}
          <div style={{ fontSize:12.5, color:subColor, marginTop:6 }}>{email}</div>
        </div>

        {/* Stats */}
        <div style={{ display:'flex', gap:10, marginTop:20 }}>
          {[{v:stats.groups||'–',l:'Groups Joined'},{v:stats.spaces||'–',l:'Spaces Involved'},{v:stats.events||'–',l:'Events Attended'}].map(s=>(
            <div key={s.l} style={{ flex:1, background:cardBg, borderRadius:18, padding:'13px 8px', textAlign:'center', boxShadow:'0 4px 14px rgba(16,24,40,0.05)', transition:'background .3s' }}>
              <div style={{ fontSize:19, fontWeight:800, color:textColor }}>{s.v}</div>
              <div style={{ fontSize:11, fontWeight:600, color:subColor, marginTop:2 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Settings groups */}
        {SETTINGS_GROUPS.map(g => (
          <div key={g.title} style={{ marginTop:24 }}>
            <div style={{ fontSize:11, fontWeight:800, letterSpacing:0.6, textTransform:'uppercase', color:subColor, margin:'0 4px 9px' }}>{g.title}</div>
            <div style={{ background:cardBg, borderRadius:18, boxShadow:'0 4px 14px rgba(16,24,40,0.05)', overflow:'hidden', transition:'background .3s' }}>
              {g.rows.map((r, i) => (
                <div key={r.title}>
                  <div
                    onClick={r.hasChevron ? r.onClick : undefined}
                    style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 14px',
                             cursor: r.hasChevron ? 'pointer' : 'default' }}>
                    <div style={{ width:38, height:38, borderRadius:11, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', background:r.icon }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d={r.iconPath} stroke={r.iconStroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>{r.iconPath2&&<path d={r.iconPath2} stroke={r.iconStroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={r.iconPath2Dash?'0.5 3':undefined}/>}</svg>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14.5, fontWeight:700, color:textColor }}>{r.title}</div>
                    </div>
                    {r.isToggle && <Toggle value={r.toggleVal} onChange={e => { e.stopPropagation(); r.onToggle(); }} />}
                    {r.hasChevron && (
                      <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                        {r.value && <span style={{ fontSize:13, fontWeight:700, color:subColor }}>{r.value}</span>}
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke="#C5CBD6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    )}
                  </div>
                  {i < g.rows.length-1 && <div style={{ height:1, background:borderColor, marginLeft:64 }} />}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Logout */}
        <button onClick={async ()=>{ if (cu.logout) await cu.logout(); else showToast('Signed out'); }} style={{ width:'100%', height:52, marginTop:24, border:'none', borderRadius:16, background:'linear-gradient(135deg,#FF6B4D,#F4452B)', color:'#fff', fontSize:15.5, fontWeight:800, letterSpacing:0.4, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", display:'flex', alignItems:'center', justifyContent:'center', gap:9, boxShadow:'0 8px 20px rgba(244,69,43,0.32)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 12h10m0 0-3-3m3 3-3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          LOGOUT
        </button>
        <div style={{ textAlign:'center', fontSize:11, color:subColor, marginTop:16 }}>Riply · v1.0.0</div>
      </div>

      {/* Edit Profile Sheet */}
      {editOpen && (
        <Sheet onClose={()=>setEditOpen(false)} title="Edit Profile">
          {/* Avatar */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', marginBottom:20 }}>
            <button onClick={() => {
              const input = document.createElement('input');
              input.type = 'file'; input.accept = 'image/*';
              input.onchange = async (e) => {
                const file = e.target.files[0]; if (!file) return;
                setUploadingPhoto(true);
                try {
                  const url = await uploadImage(file, 'post-media', `avatars/${currentUser.userId}.jpg`);
                  const { error } = await currentUser.updateProfile({ avatar_url: url });
                  if (error) showToast('Save failed: ' + error.message);
                  else showToast('Profile photo updated ✓');
                } catch(err) { showToast('Upload failed: ' + err.message); }
                finally { setUploadingPhoto(false); }
              };
              input.click();
            }} style={{ width:80, height:80, borderRadius:'50%', padding:3, background:C.grad, border:'none', cursor:'pointer', position:'relative', boxShadow:'0 6px 16px rgba(2,162,240,0.3)', opacity: uploadingPhoto ? 0.6 : 1 }}>
              <div style={{ width:'100%', height:'100%', borderRadius:'50%', background: currentUser.avatarColor || 'linear-gradient(135deg,#FF8A3D,#FF5A8A)', display:'flex', alignItems:'center', justifyContent:'center', border:`3px solid ${cardBg}`, overflow:'hidden' }}>
                {currentUser.avatarUrl
                  ? <img src={currentUser.avatarUrl} alt="avatar" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                  : <span style={{ fontSize:26, fontWeight:800, color:'#fff' }}>{initials}</span>
                }
              </div>
              <div style={{ position:'absolute', bottom:2, right:2, width:24, height:24, borderRadius:'50%', background:C.primary, display:'flex', alignItems:'center', justifyContent:'center', border:`2px solid ${cardBg}` }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 19h3l9-9-3-3-9 9v3Z" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/></svg>
              </div>
            </button>
            <div style={{ fontSize:13, color:subColor, marginTop:8 }}>Tap to change photo</div>
          </div>

          {/* Fields */}
          {[
            { label:'Full Name', val:draftName, set:setDraftName, type:'text', mode:undefined },
            { label:'University', val:draftUniversity, set:setDraftUniversity, type:'text', mode:undefined },
            { label:'Year', val:draftYear, set:setDraftYear, type:'text', mode:undefined, placeholder:'e.g. Sophomore, 2nd Year' },
            { label:'Program / Major', val:draftProgram, set:setDraftProgram, type:'text', mode:undefined, placeholder:'e.g. Computer Science' },
          ].map(f => (
            <div key={f.label} style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:0.4, textTransform:'uppercase', color:subColor, marginBottom:7 }}>{f.label}</div>
              {f.type === 'textarea'
                ? <textarea value={f.val} onChange={e=>f.set(e.target.value)} placeholder="Tell people about yourself…" rows={3} style={{ width:'100%', boxSizing:'border-box', border:`1.5px solid ${borderColor}`, borderRadius:14, background:chipBg, padding:'12px 14px', fontSize:14, fontWeight:600, color:textColor, outline:'none', fontFamily:"'Montserrat',-apple-system,sans-serif", resize:'none', lineHeight:1.5 }} />
                : <input value={f.val} onChange={e=>f.set(e.target.value)} inputMode={f.mode} placeholder={f.placeholder||''} style={{ width:'100%', boxSizing:'border-box', height:48, border:`1.5px solid ${borderColor}`, borderRadius:14, background:chipBg, padding:'0 14px', fontSize:15, fontWeight:700, color:textColor, outline:'none', fontFamily:"'Montserrat',-apple-system,sans-serif" }} />
              }
            </div>
          ))}

          <button onClick={async ()=>{
            if(draftName.trim().length<2){showToast('Name must be at least 2 characters');return;}
            setSaving(true);
            const { error } = await currentUser.updateProfile({ name: draftName.trim(), university: draftUniversity.trim(), year: draftYear.trim(), program: draftProgram.trim() });
            setSaving(false);
            if(error){ showToast('Failed to save: ' + (error.message || 'Unknown error')); return; }
            await currentUser.refetchProfile();
            setEditOpen(false);
            showToast('Profile updated ✓');
          }} style={{ width:'100%', height:52, marginTop:6, border:'none', borderRadius:15, background:C.grad, color:'#fff', fontSize:16, fontWeight:800, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", boxShadow:'0 8px 20px rgba(2,162,240,0.4)', opacity: saving?0.7:1 }}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </Sheet>
      )}


      {/* Change Password Sheet */}
      {pwOpen && <ChangePasswordSheet onClose={()=>setPwOpen(false)} showToast={showToast} chipBg={chipBg} borderColor={borderColor} textColor={textColor} subColor={subColor} />}

      {/* Change Email Sheet */}
      {emailOpen && <ChangeEmailSheet onClose={()=>setEmailOpen(false)} showToast={showToast} currentUser={currentUser} chipBg={chipBg} borderColor={borderColor} textColor={textColor} subColor={subColor} />}

      {/* Payment Methods Sheet */}
      {payOpen && (
        <Sheet onClose={()=>setPayOpen(false)} title="Payment Methods">
          <div style={{ padding:'4px 0 8px' }}>
            {[{label:'Apple Pay', icon:'M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z'},{label:'Google Pay', icon:'M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z'},{label:'Credit / Debit Card', icon:'M2 7h20v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7zM2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2M6 12h4'}].map(p=>(
              <div key={p.label} onClick={()=>showToast(`${p.label} coming soon`)} style={{ display:'flex', alignItems:'center', gap:14, padding:'15px 0', borderBottom:`1px solid ${borderColor}`, cursor:'pointer' }}>
                <div style={{ width:40, height:40, borderRadius:12, background:chipBg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d={p.icon} stroke={C.primary} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <span style={{ flex:1, fontSize:15, fontWeight:700, color:textColor }}>{p.label}</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke="#C5CBD6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            ))}
            <button onClick={()=>showToast('Add payment method coming soon')} style={{ width:'100%', height:50, marginTop:18, border:`1.5px dashed ${borderColor}`, borderRadius:14, background:'none', color:C.primary, fontSize:15, fontWeight:700, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke={C.primary} strokeWidth="2.2" strokeLinecap="round"/></svg>
              Add Payment Method
            </button>
          </div>
        </Sheet>
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// APP ROOT
// ─────────────────────────────────────────────────────────────



// ─────────────────────────────────────────────────────────────
// SCREEN: WELCOME (2-slide onboarding carousel)
// ─────────────────────────────────────────────────────────────
function WelcomeScreen({ navigate, setScreen }) {
  const SLIDES = [
    { img: 'https://images.unsplash.com/photo-1562774053-701939374585?w=900&q=80' },
    { img: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=900&q=80' },
  ];

  const [slide, setSlide] = useState(0);
  const onSlide2 = slide === 1;

  const goGetStarted = () => {
    setScreen('auth', { initialStep: 'role' });
  };

  // Real swipe/drag support between the two slides
  const touchStartX = useRef(null);
  const touchDeltaX = useRef(0);

  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; touchDeltaX.current = 0; };
  const onTouchMove = (e) => {
    if (touchStartX.current == null) return;
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  };
  const onTouchEnd = () => {
    if (touchStartX.current == null) return;
    const dx = touchDeltaX.current;
    const THRESHOLD = 50;
    if (dx <= -THRESHOLD && slide === 0) setSlide(1);
    else if (dx >= THRESHOLD && slide === 1) setSlide(0);
    touchStartX.current = null;
    touchDeltaX.current = 0;
  };

  return (
    <div
      style={{ height:'100%', position:'relative', overflow:'hidden',
                  background:'#0a0a0a', fontFamily:"'Montserrat',-apple-system,sans-serif", touchAction:'pan-y' }}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <style>{`@keyframes wFade{from{opacity:0}to{opacity:1}}`}</style>

      {/* Full-bleed background photo */}
      <div key={slide} style={{ position:'absolute', inset:0, animation:'wFade 0.45s ease' }}>
        <img src={SLIDES[slide].img} alt=""
          style={{ width:'100%', height:'100%', objectFit:'cover', objectPosition:'center' }}/>
        {/* dark overlay */}
        <div style={{ position:'absolute', inset:0,
          background:'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.45) 50%, rgba(0,0,0,0.72) 100%)' }}/>
      </div>

      {/* Content layer */}
      <div style={{ position:'relative', zIndex:4, height:'100%', display:'flex',
                    flexDirection:'column', alignItems:'center' }}>

        {/* Pill indicators */}
        <div style={{ display:'flex', gap:8, marginTop:58, marginBottom:0 }}>
          {SLIDES.map((_, i) => (
            <div key={i} style={{
              height:4, borderRadius:999, transition:'all .35s',
              width: i === slide ? 36 : 20,
              background: i === slide ? '#19BFFF' : 'rgba(255,255,255,0.45)',
            }}/>
          ))}
        </div>

        {/* Logo block */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', marginTop:40 }}>
          <RiplyMark w={440} h={220} blue />
          <div style={{ fontSize:34, fontWeight:900, letterSpacing:6, color:'#19BFFF', marginTop:-12 }}>
            RIPLY
          </div>
          <div style={{ fontSize:13, fontWeight:800, letterSpacing:3, color:'rgba(255,255,255,0.85)',
                        marginTop:6, textAlign:'center' }}>
            CAMPUS CONNECTIONS MADE EASY
          </div>
        </div>

        {/* Spacer */}
        <div style={{ flex:1 }}/>

        {/* Slide 1 content */}
        {!onSlide2 && (
          <div style={{ width:'100%', padding:'0 28px 60px', display:'flex',
                        flexDirection:'column', alignItems:'center' }}>
            <div style={{ fontSize:24, fontWeight:800, color:'#fff', textAlign:'center',
                          lineHeight:1.45, marginBottom:48 }}>
              Find your space.<br/>
              Explore campus events.<br/>
              Build real lasting connections.
            </div>
            <button onClick={() => setSlide(1)}
              style={{ border:'none', background:'none', cursor:'pointer', padding:0,
                       display:'flex', alignItems:'center', gap:11,
                       fontFamily:"'Montserrat',-apple-system,sans-serif",
                       fontSize:19, fontWeight:700, letterSpacing:1.2, color:'#19BFFF' }}>
              Get Started
              <svg width="14" height="22" viewBox="0 0 14 22" fill="none">
                <path d="M2 2l9 9-9 9" stroke="#19BFFF" strokeWidth="2.6"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}

        {/* Slide 2 content */}
        {onSlide2 && (
          <div style={{ width:'100%', padding:'0 22px 32px', display:'flex',
                        flexDirection:'column', alignItems:'center' }}>
            <div style={{ fontSize:26, fontWeight:800, color:'#fff', textAlign:'center',
                          marginBottom:10 }}>
              Let's get started!
            </div>
            <div style={{ fontSize:16, color:'rgba(255,255,255,0.78)', textAlign:'center',
                          lineHeight:1.55, marginBottom:28 }}>
              Join thousands of students on campus<br/>and make meaningful connections
            </div>

            <button onClick={goGetStarted} style={{
              width:'100%', height:54, border:'none', borderRadius:999,
              background:'#19BFFF', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', gap:10,
              fontSize:17, fontWeight:700, color:'#fff',
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              boxShadow:'0 6px 20px rgba(25,191,255,0.35)',
            }}>
              Get Started
            </button>

            <div style={{ textAlign:'center', marginTop:16, fontSize:13.5,
                          color:'rgba(255,255,255,0.55)', lineHeight:1.6 }}>
              By signing up, you agree to our{' '}
              <span style={{ color:'#19BFFF', cursor:'pointer' }}>Terms of Service</span> and{' '}
              <span style={{ color:'#19BFFF', cursor:'pointer' }}>Privacy Policy</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const bgWash = {
  position:'absolute', inset:0, pointerEvents:'none',
  background:'radial-gradient(ellipse at 60% 0%,rgba(2,182,254,0.10) 0%,transparent 65%),radial-gradient(ellipse at 20% 100%,rgba(124,92,255,0.08) 0%,transparent 60%)',
};

function AuthBigBtn({ onClick, children, color, loading, fullWidth }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={loading ? undefined : onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        width: fullWidth ? '100%' : 204, height:52, border:'none', borderRadius:999,
        cursor: loading ? 'default' : 'pointer',
        background: color||'linear-gradient(135deg,#19BFFF,#1499F5)',
        color:'#fff', fontSize:17, fontWeight:800,
        fontFamily:"'Montserrat',-apple-system,sans-serif",
        boxShadow: pressed ? '0 2px 8px rgba(2,162,240,0.25)' : '0 8px 22px rgba(2,162,240,0.4)',
        transform: pressed ? 'scale(0.97)' : 'scale(1)',
        transition: 'transform 0.12s ease, box-shadow 0.12s ease',
        opacity: loading ? 0.7 : 1,
        display:'flex', alignItems:'center', justifyContent:'center', gap:8,
      }}>
      {loading && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ animation:'riplySpin 0.7s linear infinite', flexShrink:0 }}><circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5"/><path d="M12 3a9 9 0 0 1 9 9" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg>}
      {children}
    </button>
  );
}

// Auth helpers — defined outside AuthScreen so they're stable across renders
function AuthBg() {
  return (
    <>
      <img src="https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=900&q=80"
        alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%',
          objectFit:'cover', objectPosition:'center' }} />
      <div style={{ position:'absolute', inset:0,
        background:'linear-gradient(to bottom,rgba(8,12,24,0.72) 0%,rgba(8,12,24,0.80) 100%)' }}/>
    </>
  );
}

function DarkPillInput({ value, onChange, placeholder, type='text', inputMode, icon, right }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10,
      background:'rgba(255,255,255,0.95)', borderRadius:999,
      padding:'0 18px', height:54 }}>
      <input value={value} onChange={onChange} placeholder={placeholder}
        type={type} inputMode={inputMode}
        style={{ flex:1, border:'none', background:'none', outline:'none',
          fontSize:16, fontWeight:600, color:'#111', fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
      {right}
      {icon && <span style={{ flexShrink:0, opacity:0.5 }}>{icon}</span>}
    </div>
  );
}

function DarkEyeBtn({ show, onToggle }) {
  return (
    <button onClick={onToggle} style={{ border:'none', background:'none', padding:0, cursor:'pointer',
      display:'flex', alignItems:'center', opacity:0.5, flexShrink:0 }}>
      {show
        ? <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" stroke="#111" strokeWidth="1.9"/><circle cx="12" cy="12" r="2.5" stroke="#111" strokeWidth="1.9"/><line x1="3" y1="3" x2="21" y2="21" stroke="#111" strokeWidth="1.9" strokeLinecap="round"/></svg>
        : <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" stroke="#111" strokeWidth="1.9"/><circle cx="12" cy="12" r="2.5" stroke="#111" strokeWidth="1.9"/></svg>
      }
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: AUTH  (signup → verify → onboard → role → home)
// ─────────────────────────────────────────────────────────────
function AuthScreen({ setScreen, showToast, initialStep, initialRole, currentUser }) {
  // ── step machine ──────────────────────────────────────────
  const [step,    setStep]    = useState(initialStep || 'login');  // login | signup | verify | second-factor | onboard | role
  const [animKey, setAnimKey] = useState(0);
  const [code, setCode] = useState(['','','','','','']);
  const codeRef0=useRef(null),codeRef1=useRef(null),codeRef2=useRef(null),codeRef3=useRef(null),codeRef4=useRef(null),codeRef5=useRef(null);
  const codeRefs=[codeRef0,codeRef1,codeRef2,codeRef3,codeRef4,codeRef5];
  const [loading, setLoading] = useState(false);
  // Ref mirror of `loading` so a second click landing before the state update
  // flushes (e.g. a fast double-tap) still sees the in-flight request and bails.
  const loadingRef = useRef(false);
  const withLoading = (fn) => async (...args) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try { await fn(...args); } finally { loadingRef.current = false; setLoading(false); }
  };
  const [backupCode, setBackupCode] = useState('');
  // Reset OTP/backup-code state synchronously on transitions into a fresh
  // code-entry step, so leftover digits from a previous attempt don't
  // briefly flash before clearing.
  const go = (s) => {
    if (s === 'second-factor' || s === 'reset-password') { setCode(['','','','','','']); setBackupCode(''); }
    setStep(s); setAnimKey(k => k+1);
  };
  const { login, signup, verify, completeOnboarding, secondFactor, verifySecondFactor, resendSecondFactor, requestPasswordReset, resendPasswordReset, resetPassword } = useClerkAuth(showToast, setScreen, go, currentUser?.refetchProfile);
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode,  setResetCode]  = useState('');
  const [newPw,      setNewPw]      = useState('');
  const [confirmNewPw, setConfirmNewPw] = useState('');

  // ── field state ───────────────────────────────────────────
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [gender,   setGender]   = useState('');
  const [genderOpen, setGenderOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [showCf,   setShowCf]   = useState(false);

  // onboard
  const [university, setUniversity] = useState('University of Manitoba');
  const [campus,     setCampus]     = useState('');
  const [campusOpen, setCampusOpen] = useState(false);
  const [program,    setProgram]    = useState('');
  const [year,       setYear]       = useState('');

  // role
  const [role, setRole] = useState(initialRole || '');

  const CAMPUSES = ['Fort Garry', 'Bannatyne', 'William Norrie Centre'];
  const YEARS    = ['1st Year','2nd Year','3rd Year','4th Year','5th+ Year'];
  const GENDERS  = ['Man','Woman','Non-binary','Prefer not to say'];

  const ROLES = [
    { id:'student',   title:'Student',         sub:'Discover events, join groups and buy tickets.',            color:'#0098F0', bg:'#E9F6FF' },
    { id:'organizer', title:'Event Organizer',  sub:'Create and manage ticketed events on campus.',            color:'#7C5CFF', bg:'#F1ECFF' },
    { id:'admin',     title:'Group Admin',      sub:'Run a campus club — post, moderate and manage members.',  color:'#15A34A', bg:'#E4F7EC' },
  ];

  // The role step is now reached before signup (from the welcome screen's
  // "Get Started" button) rather than after it, so its Continue button
  // should advance to signup instead of completing onboarding.
  const preSignupRoleFlow = initialStep === 'role';
  const STEP_ORDER = preSignupRoleFlow
    ? ['role','signup','verify','onboard']
    : ['signup','verify','onboard','role'];
  const currentStepIndex = STEP_ORDER.indexOf(step);

  const slideStyle = { animation:`authSlide 0.26s cubic-bezier(.4,0,.2,1)` };

  // ── LOGIN ─────────────────────────────────────────────────
  if (step === 'login') return (
    <div key={animKey} style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                  fontFamily:"'Montserrat',-apple-system,sans-serif", overflow:'hidden', ...slideStyle }}>
      <style>{`@keyframes authSlide{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <AuthBg />
      {/* scrollable content */}
      <div style={{ position:'relative', flex:1, overflowY:'auto', display:'flex',
                    flexDirection:'column', padding:'0 28px 40px' }}>
        {/* Logo block */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                      paddingTop:72, paddingBottom:36 }}>
          <RiplyMark w={220} h={110} blue />
          <div style={{ fontSize:30, fontWeight:900, letterSpacing:4, color:'#19BFFF', marginTop:10 }}>RIPLY</div>
          <div style={{ fontSize:13, fontWeight:700, letterSpacing:2.5, color:'rgba(255,255,255,0.75)',
                        marginTop:4, textAlign:'center' }}>CAMPUS CONNECTIONS MADE EASY</div>
        </div>
        {/* Fields */}
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <DarkPillInput value={email} onChange={e=>setEmail(e.target.value)}
            placeholder="student email" inputMode="email"
            icon={<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="17" height="13" rx="3" stroke="#111" strokeWidth="1.9"/><path d="m4.5 7 7.5 5.5L19.5 7" stroke="#111" strokeWidth="1.9" strokeLinejoin="round"/></svg>}
          />
          <DarkPillInput value={password} onChange={e=>setPassword(e.target.value)}
            placeholder="password" type={showPw?'text':'password'}
            right={<DarkEyeBtn show={showPw} onToggle={()=>setShowPw(v=>!v)}/>}
          />
        </div>
        {/* Forgot */}
        <span onClick={()=>{ setResetEmail(email); go('forgot-password'); }}
          style={{ fontSize:15, fontWeight:700, color:'#19BFFF', marginTop:14,
                   cursor:'pointer', alignSelf:'flex-end' }}>
          Forgot Password?
        </span>
        <div style={{ height:28 }}/>
        {/* Log In button */}
        <button onClick={withLoading(()=>login(email, password))} disabled={loading}
          style={{ width:'100%', height:54, border:'none', borderRadius:999,
            background:'linear-gradient(135deg,#19BFFF,#008FF0)', color:'#fff',
            fontSize:17, fontWeight:800, cursor: loading?'default':'pointer',
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            boxShadow:'0 10px 26px rgba(2,162,240,0.50)', opacity: loading?0.75:1 }}>
          {loading && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ animation:'riplySpin 0.7s linear infinite' }}><circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5"/><path d="M12 3a9 9 0 0 1 9 9" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg>}
          {loading ? 'Signing in…' : 'Log In'}
        </button>
        <div style={{ flex:1, minHeight:24 }}/>
        {/* Footer */}
        <div style={{ textAlign:'center', fontSize:15, color:'rgba(255,255,255,0.7)', marginTop:24 }}>
          New to RIPLY?{' '}
          <span onClick={()=>go('signup')} style={{ color:'#19BFFF', fontWeight:800, cursor:'pointer' }}>
            Sign Up
          </span>
        </div>
      </div>
    </div>
  );

  // ── SIGNUP ────────────────────────────────────────────────
  if (step === 'signup') return (
    <div key={animKey} style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                  fontFamily:"'Montserrat',-apple-system,sans-serif", overflow:'hidden', ...slideStyle }}>
      <AuthBg />
      {/* Scrollable fields area */}
      <div style={{ position:'relative', flex:1, overflowY:'auto', padding:'0 28px 20px' }}>
        {/* Logo block */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                      paddingTop:56, paddingBottom:28 }}>
          <RiplyMark w={220} h={110} blue />
          <div style={{ fontSize:26, fontWeight:900, letterSpacing:4, color:'#19BFFF', marginTop:8 }}>RIPLY</div>
          <div style={{ fontSize:12.5, fontWeight:700, letterSpacing:2.5, color:'rgba(255,255,255,0.75)',
                        marginTop:3, textAlign:'center' }}>CAMPUS CONNECTIONS MADE EASY</div>
        </div>
        {/* Fields */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <DarkPillInput value={name} onChange={e=>setName(e.target.value)}
            placeholder="username"
            icon={<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke="#111" strokeWidth="1.9"/><path d="M5 20c0-3.6 3-5.6 7-5.6s7 2 7 5.6" stroke="#111" strokeWidth="1.9" strokeLinecap="round"/></svg>}
          />
          <DarkPillInput value={email} onChange={e=>setEmail(e.target.value)}
            placeholder="student email" inputMode="email"
            icon={<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="17" height="13" rx="3" stroke="#111" strokeWidth="1.9"/><path d="m4.5 7 7.5 5.5L19.5 7" stroke="#111" strokeWidth="1.9" strokeLinejoin="round"/></svg>}
          />
          {/* Gender picker */}
          <div>
            <div onClick={()=>setGenderOpen(v=>!v)} style={{ display:'flex', alignItems:'center',
              gap:10, background:'rgba(255,255,255,0.95)', borderRadius:999,
              padding:'0 18px', height:54, cursor:'pointer' }}>
              <span style={{ flex:1, fontSize:16, fontWeight:600,
                             color: gender ? '#111' : 'rgba(0,0,0,0.45)' }}>
                {gender || 'gender'}
              </span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ opacity:0.45, flexShrink:0 }}>
                <path d="m6 9 6 6 6-6" stroke="#111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            {genderOpen && (
              <div style={{ background:'#fff', borderRadius:16,
                            boxShadow:'0 6px 18px rgba(0,0,0,0.20)', overflow:'hidden', marginTop:6 }}>
                {GENDERS.map(g => (
                  <div key={g} onClick={()=>{setGender(g);setGenderOpen(false);}}
                    style={{ padding:'13px 20px', fontSize:16, fontWeight:600,
                             color: gender===g ? C.primary : '#111', cursor:'pointer',
                             background: gender===g ? '#EAF6FF' : 'none',
                             borderBottom:'1px solid rgba(0,0,0,0.07)' }}>
                    {g}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DarkPillInput value={password} onChange={e=>setPassword(e.target.value)}
            placeholder="password" type={showPw?'text':'password'}
            right={<DarkEyeBtn show={showPw} onToggle={()=>setShowPw(v=>!v)}/>}
          />
          <DarkPillInput value={confirm} onChange={e=>setConfirm(e.target.value)}
            placeholder="confirm password" type={showCf?'text':'password'}
            right={<DarkEyeBtn show={showCf} onToggle={()=>setShowCf(v=>!v)}/>}
          />
        </div>
      </div>
      {/* Button + footer — pinned to bottom, never scrolls */}
      <div style={{ position:'relative', flexShrink:0, padding:'16px 28px 32px' }}>
        <button onClick={withLoading(()=>signup(name, email, password, confirm))} disabled={loading}
          style={{ width:'100%', height:54, border:'none', borderRadius:999,
            background:'linear-gradient(135deg,#19BFFF,#008FF0)', color:'#fff',
            fontSize:17, fontWeight:800, cursor: loading?'default':'pointer',
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            boxShadow:'0 10px 26px rgba(2,162,240,0.50)', opacity: loading?0.75:1 }}>
          {loading && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ animation:'riplySpin 0.7s linear infinite' }}><circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5"/><path d="M12 3a9 9 0 0 1 9 9" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg>}
          {loading ? 'Creating account…' : 'Sign Up'}
        </button>
        <div style={{ textAlign:'center', fontSize:15, color:'rgba(255,255,255,0.7)', marginTop:10 }}>
          Already have an account?{' '}
          <span onClick={()=>go('login')} style={{ color:'#19BFFF', fontWeight:800, cursor:'pointer' }}>
            Log In
          </span>
        </div>
      </div>
    </div>
  );

  // ── VERIFY ────────────────────────────────────────────────
  if (step === 'verify') {
    const inputs = Array.from({length:6},(_,i)=>i);
    const handleKey = (i,e) => {
      const v = e.target.value.replace(/\D/g,'').slice(-1);
      const nc=[...code]; nc[i]=v; setCode(nc);
      if(v&&i<5) codeRefs[i+1].current?.focus();
      if(!v&&i>0&&e.nativeEvent.inputType==='deleteContentBackward') codeRefs[i-1].current?.focus();
    };
    const handlePaste = (e) => {
      const digits = e.clipboardData.getData('text').replace(/\D/g,'').slice(0,6).split('');
      if(!digits.length) return;
      e.preventDefault();
      const nc=['','','','','',''];
      digits.forEach((d,i)=>{ nc[i]=d; });
      setCode(nc);
      const focusIdx = Math.min(digits.length, 5);
      codeRefs[focusIdx].current?.focus();
    };
    return (
      <div key={animKey} style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                    background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif",
                    overflow:'hidden', ...slideStyle }}>
        <div style={bgWash}/>
        <div style={{ position:'relative', flexShrink:0, padding:'52px 16px 0',
                      display:'flex', alignItems:'center', gap:10 }}>
          <button onClick={()=>go('signup')} style={{ width:38, height:38, border:'none',
            borderRadius:999, background:'#fff', boxShadow:`0 2px 8px rgba(16,24,40,0.08)`,
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span style={{ flex:1, textAlign:'center', fontSize:15, fontWeight:800,
                         letterSpacing:1.5, color:C.ink, marginRight:38 }}>
            EMAIL VERIFICATION
          </span>
        </div>
        <div style={{ position:'relative', flex:1, display:'flex', flexDirection:'column',
                      alignItems:'center', padding:'40px 32px 0' }}>
          <div style={{ width:70, height:70, borderRadius:20,
                        background:'linear-gradient(135deg,#19BFFF,#1499F5)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        boxShadow:'0 10px 26px rgba(2,162,240,0.46)' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="5.5" width="18" height="13.5" rx="3" stroke="#fff" strokeWidth="2"/>
              <path d="m4 7 8 6 8-6" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.4, color:C.ink,
                        marginTop:24 }}>Enter Verification Code</div>
          <div style={{ fontSize:15, lineHeight:1.6, color:'#7B8499', textAlign:'center',
                        marginTop:10, maxWidth:280 }}>
            We've sent a 6-digit code to your student email. Enter it below to continue.
          </div>
          {/* OTP inputs */}
          <div style={{ display:'flex', gap:11, marginTop:28 }}>
            {inputs.map(i=>(
              <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
                <div style={{ width:14, height:14, borderRadius:'50%',
                              background: code[i] ? C.primary : '#E4E8EF',
                              transition:'background .2s', pointerEvents:'none' }}/>
                <input ref={codeRefs[i]} value={code[i]} onChange={e=>handleKey(i,e)}
                  onPaste={i===0 ? handlePaste : undefined}
                  maxLength={1} inputMode="numeric"
                  style={{ width:44, height:44, border:'none',
                           borderBottom: `2.5px solid ${code[i]?C.primary:'#D4D9E2'}`,
                           background:'none', outline:'none', textAlign:'center',
                           fontSize:22, fontWeight:700, color:C.ink, caretColor:C.primary,
                           transition:'border-color 0.15s' }}/>
              </div>
            ))}
          </div>
          <div style={{ fontSize:15, color:'#7B8499', marginTop:24 }}>
            Didn't receive the code?{' '}
            <span onClick={()=>{
              setCode(['1','2','3','4','5','6']);
              showToast('A new code is on its way');
            }} style={{ color:C.primary, fontWeight:800, cursor:'pointer' }}>Resend</span>
          </div>
        </div>
        <div style={{ position:'relative', flexShrink:0, padding:'14px 26px 32px' }}>
        <AuthBigBtn onClick={withLoading(()=>verify(code.join('')))} loading={loading} fullWidth>Verify</AuthBigBtn>
        </div>
      </div>
    );
  }

  // ── FORGOT PASSWORD: request a reset code ────────────────
  if (step === 'forgot-password') {
    return (
      <div key={animKey} style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                    background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif",
                    overflow:'hidden', ...slideStyle }}>
        <div style={bgWash}/>
        <div style={{ position:'relative', flexShrink:0, padding:'52px 16px 0',
                      display:'flex', alignItems:'center', gap:10 }}>
          <button onClick={()=>go('login')} style={{ width:38, height:38, border:'none',
            borderRadius:999, background:'#fff', boxShadow:`0 2px 8px rgba(16,24,40,0.08)`,
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span style={{ flex:1, textAlign:'center', fontSize:15, fontWeight:800,
                         letterSpacing:1.5, color:C.ink, marginRight:38 }}>
            RESET PASSWORD
          </span>
        </div>
        <div style={{ position:'relative', flex:1, display:'flex', flexDirection:'column',
                      alignItems:'center', padding:'40px 32px 0' }}>
          <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.4, color:C.ink, textAlign:'center' }}>
            Forgot your password?
          </div>
          <div style={{ fontSize:15, lineHeight:1.6, color:'#7B8499', textAlign:'center',
                        marginTop:10, maxWidth:280 }}>
            Enter your student email and we'll send you a code to reset it.
          </div>
          <div style={{ width:'100%', marginTop:26 }}>
            <input value={resetEmail} onChange={e=>setResetEmail(e.target.value)}
              placeholder="student email" inputMode="email"
              style={{ width:'100%', boxSizing:'border-box', height:52, border:`1.5px solid ${C.border}`,
                       borderRadius:16, background:C.chip, padding:'0 16px', fontSize:16, fontWeight:700,
                       color:C.ink, outline:'none', fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
          </div>
        </div>
        <div style={{ position:'relative', flexShrink:0, padding:'14px 26px 32px' }}>
          <AuthBigBtn onClick={withLoading(()=>requestPasswordReset(resetEmail))} loading={loading} fullWidth>
            Send Reset Code
          </AuthBigBtn>
        </div>
      </div>
    );
  }

  // ── RESET PASSWORD: enter code + new password ────────────
  if (step === 'reset-password') {
    const inputs = Array.from({length:6},(_,i)=>i);
    const handleKey = (i,e) => {
      const v = e.target.value.replace(/\D/g,'').slice(-1);
      const nc=[...code]; nc[i]=v; setCode(nc);
      if(v&&i<5) codeRefs[i+1].current?.focus();
      if(!v&&i>0&&e.nativeEvent.inputType==='deleteContentBackward') codeRefs[i-1].current?.focus();
    };
    const handlePaste = (e) => {
      const digits = e.clipboardData.getData('text').replace(/\D/g,'').slice(0,6).split('');
      if(!digits.length) return;
      e.preventDefault();
      const nc=['','','','','',''];
      digits.forEach((d,i)=>{ nc[i]=d; });
      setCode(nc);
      const focusIdx = Math.min(digits.length, 5);
      codeRefs[focusIdx].current?.focus();
    };
    return (
      <div key={animKey} style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                    background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif",
                    overflow:'hidden', ...slideStyle }}>
        <div style={bgWash}/>
        <div style={{ position:'relative', flexShrink:0, padding:'52px 16px 0',
                      display:'flex', alignItems:'center', gap:10 }}>
          <button onClick={()=>go('forgot-password')} style={{ width:38, height:38, border:'none',
            borderRadius:999, background:'#fff', boxShadow:`0 2px 8px rgba(16,24,40,0.08)`,
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span style={{ flex:1, textAlign:'center', fontSize:15, fontWeight:800,
                         letterSpacing:1.5, color:C.ink, marginRight:38 }}>
            RESET PASSWORD
          </span>
        </div>
        <div style={{ position:'relative', flex:1, overflowY:'auto', display:'flex', flexDirection:'column',
                      alignItems:'center', padding:'32px 32px 0' }}>
          <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.4, color:C.ink,
                        textAlign:'center' }}>Enter the code</div>
          <div style={{ fontSize:15, lineHeight:1.6, color:'#7B8499', textAlign:'center',
                        marginTop:10, maxWidth:280 }}>
            We've sent a 6-digit code to {resetEmail || 'your email'}. Enter it below with your new password.
          </div>
          <div style={{ display:'flex', gap:11, marginTop:24 }}>
            {inputs.map(i=>(
              <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
                <div style={{ width:14, height:14, borderRadius:'50%',
                              background: code[i] ? C.primary : '#E4E8EF',
                              transition:'background .2s', pointerEvents:'none' }}/>
                <input ref={codeRefs[i]} value={code[i]} onChange={e=>handleKey(i,e)}
                  onPaste={i===0 ? handlePaste : undefined}
                  maxLength={1} inputMode="numeric"
                  style={{ width:44, height:44, border:'none',
                           borderBottom: `2.5px solid ${code[i]?C.primary:'#D4D9E2'}`,
                           background:'none', outline:'none', textAlign:'center',
                           fontSize:22, fontWeight:700, color:C.ink, caretColor:C.primary,
                           transition:'border-color 0.15s' }}/>
              </div>
            ))}
          </div>
          <div style={{ fontSize:15, color:'#7B8499', marginTop:18 }}>
            Didn't receive the code?{' '}
            <span onClick={resendPasswordReset} style={{ color:C.primary, fontWeight:800, cursor:'pointer' }}>Resend</span>
          </div>
          <div style={{ width:'100%', marginTop:22, display:'flex', flexDirection:'column', gap:12 }}>
            <input value={newPw} onChange={e=>setNewPw(e.target.value)} type="password"
              placeholder="new password"
              style={{ width:'100%', boxSizing:'border-box', height:52, border:`1.5px solid ${C.border}`,
                       borderRadius:16, background:C.chip, padding:'0 16px', fontSize:16, fontWeight:700,
                       color:C.ink, outline:'none', fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
            <input value={confirmNewPw} onChange={e=>setConfirmNewPw(e.target.value)} type="password"
              placeholder="confirm new password"
              style={{ width:'100%', boxSizing:'border-box', height:52, border:`1.5px solid ${C.border}`,
                       borderRadius:16, background:C.chip, padding:'0 16px', fontSize:16, fontWeight:700,
                       color:C.ink, outline:'none', fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
          </div>
        </div>
        <div style={{ position:'relative', flexShrink:0, padding:'14px 26px 32px' }}>
          <AuthBigBtn onClick={withLoading(async ()=>{
            if (newPw !== confirmNewPw) { showToast("Passwords don't match"); return; }
            await resetPassword(code.join(''), newPw);
          })} loading={loading} fullWidth>
            Reset Password
          </AuthBigBtn>
        </div>
      </div>
    );
  }

  // ── SECOND FACTOR (login) ────────────────────────────────
  if (step === 'second-factor') {
    const strategy = secondFactor?.strategy;
    const isBackup = strategy === 'backup_code';
    const canResend = strategy === 'phone_code' || strategy === 'email_code';
    const inputs = Array.from({length:6},(_,i)=>i);
    const handleKey = (i,e) => {
      const v = e.target.value.replace(/\D/g,'').slice(-1);
      const nc=[...code]; nc[i]=v; setCode(nc);
      if(v&&i<5) codeRefs[i+1].current?.focus();
      if(!v&&i>0) codeRefs[i-1].current?.focus();
    };
    const handlePaste = (e) => {
      const digits = e.clipboardData.getData('text').replace(/\D/g,'').slice(0,6).split('');
      if(!digits.length) return;
      e.preventDefault();
      const nc=['','','','','',''];
      digits.forEach((d,i)=>{ nc[i]=d; });
      setCode(nc);
      const focusIdx = Math.min(digits.length, 5);
      codeRefs[focusIdx].current?.focus();
    };
    const title = isBackup ? 'Enter Backup Code' : 'Enter Verification Code';
    const subtitle = strategy === 'totp'
      ? 'Open your authenticator app and enter the 6-digit code for Riply.'
      : strategy === 'phone_code'
      ? `We've sent a 6-digit code to ${secondFactor?.hint || 'your phone'}. Enter it below to continue.`
      : strategy === 'email_code'
      ? `We've sent a 6-digit code to ${secondFactor?.hint || 'your email'}. Enter it below to continue.`
      : 'Enter one of the backup codes you saved when you set up two-step verification.';
    return (
      <div key={animKey} style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                    background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif",
                    overflow:'hidden', ...slideStyle }}>
        <div style={bgWash}/>
        <div style={{ position:'relative', flexShrink:0, padding:'52px 16px 0',
                      display:'flex', alignItems:'center', gap:10 }}>
          <button onClick={()=>go('login')} style={{ width:38, height:38, border:'none',
            borderRadius:999, background:'#fff', boxShadow:`0 2px 8px rgba(16,24,40,0.08)`,
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <span style={{ flex:1, textAlign:'center', fontSize:15, fontWeight:800,
                         letterSpacing:1.5, color:C.ink, marginRight:38 }}>
            TWO-STEP VERIFICATION
          </span>
        </div>
        <div style={{ position:'relative', flex:1, display:'flex', flexDirection:'column',
                      alignItems:'center', padding:'40px 32px 0' }}>
          <div style={{ width:70, height:70, borderRadius:20,
                        background:'linear-gradient(135deg,#19BFFF,#1499F5)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        boxShadow:'0 10px 26px rgba(2,162,240,0.46)' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <rect x="5" y="10.5" width="14" height="10" rx="2.5" stroke="#fff" strokeWidth="2"/>
              <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.4, color:C.ink,
                        marginTop:24, textAlign:'center' }}>{title}</div>
          <div style={{ fontSize:15, lineHeight:1.6, color:'#7B8499', textAlign:'center',
                        marginTop:10, maxWidth:280 }}>
            {subtitle}
          </div>
          {isBackup ? (
            <input value={backupCode} onChange={e=>setBackupCode(e.target.value)}
              placeholder="Backup code" autoCapitalize="none" autoCorrect="off"
              style={{ width:'100%', maxWidth:280, height:54, border:`1.5px solid ${C.border}`,
                       borderRadius:999, padding:'0 20px', marginTop:28,
                       fontSize:17, fontWeight:600, color:C.ink, outline:'none',
                       fontFamily:"'Montserrat',-apple-system,sans-serif", textAlign:'center' }}/>
          ) : (
            <div style={{ display:'flex', gap:11, marginTop:28 }}>
              {inputs.map(i=>(
                <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
                  <div style={{ width:14, height:14, borderRadius:'50%',
                                background: code[i] ? C.primary : '#E4E8EF',
                                transition:'background .2s', pointerEvents:'none' }}/>
                  <input ref={codeRefs[i]} value={code[i]} onChange={e=>handleKey(i,e)}
                    onPaste={i===0 ? handlePaste : undefined}
                    maxLength={1} inputMode="numeric"
                    style={{ width:44, height:44, border:'none',
                             borderBottom: `2.5px solid ${code[i]?C.primary:'#D4D9E2'}`,
                             background:'none', outline:'none', textAlign:'center',
                             fontSize:22, fontWeight:700, color:C.ink, caretColor:C.primary,
                             transition:'border-color 0.15s' }}/>
                </div>
              ))}
            </div>
          )}
          {canResend && (
            <div style={{ fontSize:15, color:'#7B8499', marginTop:24 }}>
              Didn't receive the code?{' '}
              <button type="button" onClick={withLoading(resendSecondFactor)} disabled={loading}
                style={{ border:'none', padding:0, background:'none', font:'inherit',
                         color:C.primary, fontWeight:800, cursor:loading?'default':'pointer' }}>Resend</button>
            </div>
          )}
        </div>
        <div style={{ position:'relative', flexShrink:0, padding:'14px 26px 32px' }}>
        <AuthBigBtn
          onClick={withLoading(()=>verifySecondFactor(isBackup ? backupCode.trim() : code.join('')))}
          loading={loading} fullWidth>Verify</AuthBigBtn>
        </div>
      </div>
    );
  }

  // ── ONBOARD ───────────────────────────────────────────────
  if (step === 'onboard') return (
    <div key={animKey} style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif",
                  overflow:'hidden', ...slideStyle }}>
      <div style={bgWash}/>
      <div style={{ position:'relative', flex:1, overflowY:'auto', padding:'60px 26px 24px' }}>
        {/* Progress pip */}
        <div style={{ display:'flex', gap:6, marginBottom:28 }}>
          {STEP_ORDER.map((s,i)=>(
            <div key={s} style={{ flex:1, height:4, borderRadius:999,
              background: i<=currentStepIndex ? C.primary : '#E4E8EF' }}/>
          ))}
        </div>
        <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.5, color:C.ink, marginBottom:20 }}>
          Tell us about yourself
        </div>

        {/* University */}
        <div style={{ fontSize:15, fontWeight:700, color:C.ink, marginBottom:8 }}>University</div>
        <div style={{ display:'flex', alignItems:'center', gap:11, background:'#fff',
                      border:`1.5px solid ${C.border}`, borderRadius:999,
                      padding:'0 20px', height:54,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
          <input value={university} onChange={e=>setUniversity(e.target.value)}
            placeholder="Search your university"
            style={{ flex:1, border:'none', background:'none', fontSize:16, fontWeight:600,
                     color:C.body, outline:'none',
                     fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
            <path d="M12 3.5 4 7v1.5h16V7l-8-3.5Z" stroke={C.bright} strokeWidth="1.8" strokeLinejoin="round"/>
            <path d="M6 11v6M10 11v6M14 11v6M18 11v6M4 19.5h16" stroke={C.bright} strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </div>

        {/* Campus */}
        <div style={{ fontSize:15, fontWeight:700, color:C.ink, margin:'18px 0 8px' }}>Campus</div>
        <div onClick={()=>setCampusOpen(v=>!v)} style={{ display:'flex', alignItems:'center',
          gap:11, background:'#fff', border:`1.5px solid ${C.border}`, borderRadius:999,
          padding:'0 20px', height:54, cursor:'pointer',
          boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
          <span style={{ flex:1, fontSize:16, fontWeight:600,
                         color: campus ? C.body : C.subtle }}>
            {campus || 'Select your campus'}
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="m6 9 6 6 6-6" stroke={C.bright} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        {campusOpen && (
          <div style={{ background:'#fff', border:`1.5px solid ${C.border}`, borderRadius:16,
                        boxShadow:'0 6px 18px rgba(16,24,40,0.10)', overflow:'hidden',
                        marginTop:6 }}>
            {CAMPUSES.map(c=>(
              <div key={c} onClick={()=>{setCampus(c);setCampusOpen(false);}}
                style={{ padding:'13px 20px', fontSize:16, fontWeight:600,
                         color: campus===c ? C.primary : C.body, cursor:'pointer',
                         background: campus===c ? '#EAF6FF' : 'none',
                         borderBottom:`1px solid ${C.divider}` }}>
                {c}
              </div>
            ))}
          </div>
        )}

        {/* Program */}
        <div style={{ fontSize:15, fontWeight:700, color:C.ink, margin:'18px 0 8px' }}>Program</div>
        <div style={{ display:'flex', alignItems:'center', gap:11, background:'#fff',
                      border:`1.5px solid ${C.border}`, borderRadius:999,
                      padding:'0 20px', height:54,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
          <input value={program} onChange={e=>setProgram(e.target.value)}
            placeholder="e.g. Computer Science"
            style={{ flex:1, border:'none', background:'none', fontSize:16, fontWeight:600,
                     color:C.body, outline:'none',
                     fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
            <path d="M12 4 3 8l9 4 9-4-9-4Z" stroke={C.bright} strokeWidth="1.9" strokeLinejoin="round"/>
            <path d="M7 10.5V15c0 1.2 2.2 2.5 5 2.5s5-1.3 5-2.5v-4.5" stroke={C.bright} strokeWidth="1.9" strokeLinecap="round"/>
          </svg>
        </div>

        {/* Year */}
        <div style={{ fontSize:15, fontWeight:700, color:C.ink, margin:'20px 0 11px' }}>
          What year are you in?
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
          {YEARS.map(y=>(
            <button key={y} onClick={()=>setYear(y)} style={{
              height:38, padding:'0 16px', border:'none', borderRadius:999, cursor:'pointer',
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              fontSize:14, fontWeight:700,
              background: year===y ? C.primary : C.card,
              color: year===y ? '#fff' : C.muted,
              boxShadow: year===y ? '0 4px 12px rgba(2,162,240,0.3)' : `0 0 0 1.5px ${C.border}`,
            }}>{y}</button>
          ))}
        </div>
      </div>
      <div style={{ position:'relative', flexShrink:0, padding:'12px 26px 32px' }}>
       <AuthBigBtn fullWidth loading={loading} onClick={()=>{
          if(!university.trim()){showToast('Enter your university');return;}
          if(!campus){showToast('Select your campus');return;}
          if(role) withLoading(()=>completeOnboarding(role, university, campus, program, year))();
          else go('role');
        }}>Continue</AuthBigBtn>
      </div>
    </div>
  );

  // ── ROLE ─────────────────────────────────────────────────
  return (
    <div key={animKey} style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif",
                  overflow:'hidden', ...slideStyle }}>
      <div style={bgWash}/>
      <div style={{ position:'relative', flex:1, overflowY:'auto', padding:'62px 26px 24px' }}>
        {/* Progress pip */}
        <div style={{ display:'flex', gap:6, marginBottom:28 }}>
          {STEP_ORDER.map((s,i)=>(
            <div key={s} style={{ flex:1, height:4, borderRadius:999,
              background: i<=currentStepIndex ? C.primary : '#E4E8EF' }}/>
          ))}
        </div>
        <div style={{ fontSize:26, fontWeight:800, letterSpacing:-0.6, color:C.ink,
                      lineHeight:1.18 }}>
          How will you use Riply?
        </div>
        <div style={{ fontSize:15, lineHeight:1.6, color:'#7B8499', marginTop:9 }}>
          Choose your account type. You can always change this later in settings.
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12, marginTop:24 }}>
          {ROLES.map(r=>{
            const on = role===r.id;
            return (
              <button key={r.id} onClick={()=>setRole(r.id)} style={{
                display:'flex', alignItems:'center', gap:13, width:'100%',
                borderRadius:18, padding:15, cursor:'pointer',
                fontFamily:"'Montserrat',-apple-system,sans-serif", textAlign:'left',
                background:on?'#fff':'#fff',
                border: on?`2px solid ${C.primary}`:'2px solid #EDEFF3',
                boxShadow: on?'0 6px 18px rgba(2,162,240,0.14)':'none',
              }}>
                <div style={{ width:48, height:48, borderRadius:14, flexShrink:0,
                              background:r.bg, display:'flex', alignItems:'center',
                              justifyContent:'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="8" r="3.4" stroke={r.color} strokeWidth="1.9"/>
                    <path d="M5 20c0-3.6 3-5.6 7-5.6s7 2 7 5.6" stroke={r.color} strokeWidth="1.9" strokeLinecap="round"/>
                  </svg>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:17, fontWeight:800, color:C.ink }}>{r.title}</div>
                  <div style={{ fontSize:14, color:'#7B8499', marginTop:3, lineHeight:1.45 }}>{r.sub}</div>
                </div>
                <div style={{ width:22, height:22, borderRadius:'50%', flexShrink:0,
                              display:'flex', alignItems:'center', justifyContent:'center',
                              background: on?C.primary:'#fff',
                              border: on?'none':'2px solid #D4D9E2' }}>
                  {on&&<svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="m5 12.5 4.5 4.5L19 7" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ position:'relative', flexShrink:0, padding:'12px 26px 32px' }}>
       <AuthBigBtn
          fullWidth
          loading={loading}
          color={role ? 'linear-gradient(135deg,#19BFFF,#1499F5)' : '#E4E8EF'}
          onClick={preSignupRoleFlow
            ? (()=>{ if(role) go('signup'); else showToast('Select an account type'); })
            : withLoading(()=>completeOnboarding(role, university, campus, program, year))}
        >{role ? (preSignupRoleFlow ? 'Continue' : 'Enter Riply') : 'Select an account type'}</AuthBigBtn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// DATA — Tickets
// ─────────────────────────────────────────────────────────────
const TICKETS_DATA = [
  {
    id: 'TK-2026-001', title: 'Karaoke Night', access: 'General Admission',
    status: 'ACTIVE', date: 'Tue, Jan 15, 2026', time: '8:00 PM',
    location: 'UMSU University Centre · 3rd Floor', isPast: false,
  },
  {
    id: 'TK-2025-089', title: 'Fall Music Festival', access: 'VIP Experience',
    status: 'USED', date: 'Fri, Nov 21, 2025', time: '6:00 PM',
    location: 'Burton Cummings Theatre', isPast: true,
  },
  {
    id: 'TK-2025-064', title: 'Tech Hackathon 2025', access: 'General Admission',
    status: 'USED', date: 'Sat, Oct 11, 2025', time: '9:00 AM',
    location: 'EITC Building', isPast: true,
  },
];

// Real, scannable QR code encoding the ticket's id -- CheckInScreen decodes
// this via camera + jsQR and looks the ticket up by that id.
function TicketQRCode({ value, active }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: 136, margin: 0,
      color: { dark: active ? '#0B1420' : '#9AA3B2', light: '#0000' },
    }).then(u => { if (!cancelled) setUrl(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [value, active]);
  if (!url) return <div style={{ width:136, height:136 }} />;
  return <img src={url} width={136} height={136} alt="Ticket QR code" style={{ display:'block' }} />;
}

// ─────────────────────────────────────────────────────────────
// SCREEN: MY TICKETS
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// SCREEN: SAVED EVENTS
// ─────────────────────────────────────────────────────────────
function SavedEventsScreen({ goBack, navigate, saved, spaceSaved }) {
  const [tab, setTab] = useState('events');
  const [dbEvents, setDbEvents] = useState({});
  const [dbSpaces, setDbSpaces] = useState({});
  const [loading, setLoading] = useState(false);

  const savedIds = Object.keys(saved || {}).filter(id => saved[id]);
  const spaceSavedIds = Object.keys(spaceSaved || {}).filter(id => spaceSaved[id]);

  useEffect(() => {
    const missing = savedIds.filter(id => !dbEvents[id] && !EVENTS.find(e => String(e.id) === id));
    if (missing.length === 0) return;
    setLoading(true);
    supabase.from('events').select('*').in('id', missing)
      .or('status.is.null,status.eq.published')
      .then(({ data }) => {
        if (data?.length) setDbEvents(prev => { const n = { ...prev }; data.forEach(ev => { n[String(ev.id)] = ev; }); return n; });
        setLoading(false);
      }).catch(() => setLoading(false));
  }, [savedIds.join(',')]);

  useEffect(() => {
    const missing = spaceSavedIds.filter(id => !dbSpaces[id] && !SPACES.find(s => String(s.id) === id));
    if (missing.length === 0) return;
    supabase.from('spaces').select('*').in('id', missing)
      .then(({ data }) => {
        if (data?.length) setDbSpaces(prev => { const n = { ...prev }; data.forEach(s => { n[String(s.id)] = s; }); return n; });
      });
  }, [spaceSavedIds.join(',')]);

  const allEvents = savedIds.map(id => dbEvents[id] || EVENTS.find(e => String(e.id) === id)).filter(Boolean);
  const allSpaces = spaceSavedIds.map(id => dbSpaces[id] || SPACES.find(s => String(s.id) === id)).filter(Boolean);

  const HERO_IMGS = {
    social:   'https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=700&q=80',
    sports:   'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=700&q=80',
    academic: 'https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=700&q=80',
    arts:     'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=700&q=80',
    wellness: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=700&q=80',
    career:   'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=700&q=80',
  };

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background:C.pageBg,
                  fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      <div style={{ flexShrink:0, background:C.card, padding:'52px 16px 0',
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, paddingBottom:14 }}>
          <button onClick={goBack} style={{ width:38, height:38, border:'none', borderRadius:12,
            background:C.chip, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M14 6l-6 6 6 6" stroke={C.body} strokeWidth="2.2" strokeLinecap="round"/>
            </svg>
          </button>
          <span style={{ fontSize:20, fontWeight:800, letterSpacing:-0.4, color:C.ink }}>Saved</span>
        </div>
        <div style={{ display:'flex', gap:0, borderTop:`1px solid ${C.divider}` }}>
          {['events','spaces'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex:1, height:40, border:'none', background:'none', cursor:'pointer',
              fontSize:15, fontWeight:700,
              color: tab === t ? C.primary : C.subtle,
              borderBottom: tab === t ? `2px solid ${C.primary}` : '2px solid transparent',
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              textTransform:'capitalize',
            }}>{t === 'events' ? 'Events' : 'Spaces'}</button>
          ))}
        </div>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'16px 16px 100px' }}>
        {tab === 'events' && (
          <>
            {loading && <SkeletonRows />}
            {!loading && allEvents.length === 0 && (
              <div style={{ textAlign:'center', padding:'60px 20px' }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style={{ margin:'0 auto 14px', display:'block' }}>
                  <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z" stroke={C.border} strokeWidth="1.8" strokeLinejoin="round"/>
                </svg>
                <div style={{ fontSize:17, fontWeight:700, color:C.ink }}>No saved events yet</div>
                <div style={{ fontSize:15, color:C.subtle, marginTop:6 }}>Tap the bookmark icon on any event to save it here</div>
              </div>
            )}
            {allEvents.map(ev => {
              const img = ev.image_url || ev.imageUrl || HERO_IMGS[ev.category || ev.primary] || HERO_IMGS.social;
              return (
                <div key={ev.id} onClick={() => navigate('event-details', { eventId: ev.id })}
                  style={{ background:C.card, borderRadius:16, marginBottom:12, overflow:'hidden',
                           boxShadow:'0 2px 10px rgba(16,24,40,0.07)', cursor:'pointer' }}>
                  <div style={{ position:'relative', height:130 }}>
                    <img src={img} alt={ev.title} style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                    <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.55) 100%)' }}/>
                    <div style={{ position:'absolute', bottom:10, left:12, right:12,
                                  fontSize:17, fontWeight:800, color:'#fff',
                                  textShadow:'0 1px 4px rgba(0,0,0,0.4)', lineHeight:1.3 }}>{ev.title}</div>
                  </div>
                  <div style={{ padding:'10px 14px 14px' }}>
                    <div style={{ fontSize:14, color:C.primary, fontWeight:700 }}>
                      {ev.full_date || ev.date}{ev.time_range ? ' · ' + fmtRange(ev.time_range) : ''}
                    </div>
                    {(ev.venue || ev.location) && (
                      <div style={{ fontSize:14, color:C.subtle, marginTop:3 }}>{ev.venue || ev.location}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
        {tab === 'spaces' && (
          <>
            {allSpaces.length === 0 && (
              <div style={{ textAlign:'center', padding:'60px 20px' }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style={{ margin:'0 auto 14px', display:'block' }}>
                  <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z" stroke={C.border} strokeWidth="1.8" strokeLinejoin="round"/>
                </svg>
                <div style={{ fontSize:17, fontWeight:700, color:C.ink }}>No saved spaces yet</div>
                <div style={{ fontSize:15, color:C.subtle, marginTop:6 }}>Tap the bookmark icon on any space to save it here</div>
              </div>
            )}
            {allSpaces.map(sp => {
              const img = sp.image_url || sp.imageUrl || HERO_IMGS[sp.cat || sp.category] || HERO_IMGS.social;
              return (
                <div key={sp.id} onClick={() => navigate('space-details', { spaceId: sp.id })}
                  style={{ background:C.card, borderRadius:16, marginBottom:12, overflow:'hidden',
                           boxShadow:'0 2px 10px rgba(16,24,40,0.07)', cursor:'pointer' }}>
                  <div style={{ position:'relative', height:130 }}>
                    <img src={img} alt={sp.title} style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                    <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.55) 100%)' }}/>
                    <div style={{ position:'absolute', bottom:10, left:12, right:12,
                                  fontSize:17, fontWeight:800, color:'#fff',
                                  textShadow:'0 1px 4px rgba(0,0,0,0.4)', lineHeight:1.3 }}>{sp.title}</div>
                  </div>
                  <div style={{ padding:'10px 14px 14px' }}>
                    <div style={{ fontSize:14, color:C.primary, fontWeight:700 }}>
                      {(() => { const raw = sp.day; if (!raw || raw === 'today') return 'Today'; if (raw === 'tomorrow') return 'Tomorrow'; const d = new Date(raw + 'T00:00:00'); if (isNaN(d)) return raw; const t = new Date(); const ts = t.toISOString().slice(0,10); const tm = new Date(t.getTime()+86400000).toISOString().slice(0,10); if (raw===ts) return 'Today'; if (raw===tm) return 'Tomorrow'; return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); })()}{sp.time ? ' · ' + sp.time : ''}
                    </div>
                    {sp.location && <div style={{ fontSize:14, color:C.subtle, marginTop:3 }}>{sp.location}</div>}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function MyTicketsScreen({ goBack, navigate, showToast, setScreen }) {
  const { user } = useUser();
  const TABS = [
    { id: 'all',    label: 'All'    },
    { id: 'active', label: 'Active' },
    { id: 'used',   label: 'Used'   },
  ];
  const [tab,     setTab]     = useState('all');
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }
    // Read from `tickets` — the table TicketsScreen actually writes purchases
    // and free RSVPs into. Ticket rows are self-contained (title/access/date/
    // time/location captured at purchase time), so no join is needed.
    supabase
      .from('tickets')
      .select('id, event_id, event_title, access, location, date, time, status, purchased_at, amount_paid')
      .eq('user_id', user.id)
      .order('purchased_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { console.error('[MyTickets] fetch error:', error); setLoading(false); return; }
        const mapped = (data || []).map(t => {
          const evDate = t.date
            ? /^\d{4}-\d{2}-\d{2}$/.test(t.date)
              ? new Date(`${t.date}T00:00:00`)
              : new Date(t.date)
            : null;
          const dateValid = evDate && !isNaN(evDate);
          // Compare calendar days, not exact timestamps — otherwise an event
          // happening later today gets marked USED the moment midnight passes.
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const evDayStart = dateValid ? new Date(evDate.getFullYear(), evDate.getMonth(), evDate.getDate()) : null;
          const isPast = evDayStart ? evDayStart < today : false;
          return {
            id: t.id,
            title: t.event_title || 'Event',
            access: t.access || 'General Admission',
            status: isPast ? 'USED' : (t.status || 'ACTIVE'),
            date: dateValid ? evDate.toLocaleDateString('en-GB', { weekday:'short', month:'short', day:'numeric' }) : (t.date || '–'),
            time: t.time ? fmt12(t.time) : '–',
            location: t.location || '–',
            // Older tickets bought before this column existed have no
            // recorded amount -- show a dash rather than a misleading "Free".
            amountPaid: t.amount_paid == null ? null : t.amount_paid,
            purchasedAt: t.purchased_at,
            isPast,
          };
        });
        setTickets(mapped);
        setLoading(false);
      });
  }, [user?.id]);

  const allTickets = tickets;
  const list = tab === 'all'    ? allTickets
             : tab === 'active' ? allTickets.filter(t => t.status === 'ACTIVE')
             :                    allTickets.filter(t => t.status === 'USED');

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)',
                    backdropFilter:'blur(16px)', padding:'50px 14px 0',
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', position:'relative', zIndex:6 }}>
        <div style={{ display:'flex', alignItems:'center', gap:9, marginBottom:14 }}>
          <button onClick={goBack} style={{ width:40, height:40, border:'none', borderRadius:13,
            background:C.chip, display:'flex', alignItems:'center',
            justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
              <path d="M14 6l-6 6 6 6" stroke={C.body} strokeWidth="2.2"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div style={{ flex:1, textAlign:'center', fontSize:18, fontWeight:800,
                        letterSpacing:-0.4, color:C.ink }}>My Tickets</div>
          <div style={{ width:40, flexShrink:0 }}/>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:0, borderBottom:`1px solid ${C.divider}` }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex:1, height:40, border:'none', background:'none', cursor:'pointer',
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              fontSize:15, fontWeight: t.id===tab ? 800 : 600,
              color: t.id===tab ? C.primary : C.subtle,
              borderBottom: t.id===tab ? `2.5px solid ${C.primary}` : '2.5px solid transparent',
              marginBottom:-1, transition:'all .2s',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* ── List ──────────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', padding:'14px 14px 32px' }}>
        {loading && (
          <div style={{ textAlign:'center', padding:'60px 24px', color:C.subtle, fontSize:16, fontWeight:700 }}>
            Loading tickets…
          </div>
        )}
        {!loading && list.length === 0 && (
          <div style={{ textAlign:'center', padding:'60px 24px' }}>
            <div style={{ width:60, height:60, borderRadius:20, background:C.chip,
                          display:'flex', alignItems:'center', justifyContent:'center',
                          margin:'0 auto 14px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M4 8.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 1.8 1.8 0 0 0 0 3.4
                         1.8 1.8 0 0 0 0 3.6 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2
                         1.8 1.8 0 0 0 0-3.6 1.8 1.8 0 0 0 0-3.4Z"
                      stroke={C.subtle} strokeWidth="1.8" strokeLinejoin="round"/>
                <path d="M14 7.5v9" stroke={C.subtle} strokeWidth="1.7"
                      strokeLinecap="round" strokeDasharray="0.5 3"/>
              </svg>
            </div>
            <div style={{ fontSize:16, fontWeight:700, color:C.muted }}>No tickets here yet</div>
            <div style={{ fontSize:14, color:C.subtle, marginTop:6, lineHeight:1.5 }}>
              Reserve a spot at an event and your<br/>ticket will appear here.
            </div>
            <button onClick={() => setScreen('home')} style={{ marginTop:18, height:44, padding:'0 28px',
              border:'none', borderRadius:14, background:C.grad, color:'#fff',
              fontSize:15, fontWeight:800, cursor:'pointer',
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              boxShadow:'0 8px 20px rgba(2,162,240,0.32)' }}>
              Browse Events
            </button>
          </div>
        )}

        {list.map((tk) => {
          const isActive = tk.status === 'ACTIVE';

          return (
            <div key={tk.id} style={{ background:C.card, borderRadius:22,
              boxShadow:'0 8px 24px rgba(16,24,40,0.08),0 1px 2px rgba(16,24,40,0.04)',
              marginBottom:16, overflow:'hidden' }}>

              {/* ── Top band: gradient bar based on status ── */}
              <div style={{ height:5, background: isActive
                ? 'linear-gradient(90deg,#19BFFF,#0098F0)'
                : 'linear-gradient(90deg,#C5CBD6,#9AA3B2)' }}/>

              {/* ── Title + badge ─────────────────────────── */}
              <div style={{ padding:'14px 16px 0', display:'flex',
                            alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:19, fontWeight:800, letterSpacing:-0.4,
                                color:C.ink, lineHeight:1.2 }}>{tk.title}</div>
                  <div style={{ fontSize:14, fontWeight:700, color:C.primary, marginTop:5 }}>
                    {tk.access}
                  </div>
                </div>
                <span style={{ flexShrink:0, display:'inline-flex', alignItems:'center',
                               height:26, padding:'0 12px', borderRadius:999, fontSize:12,
                               fontWeight:800, letterSpacing:0.5, color:'#fff',
                               background: isActive
                                 ? 'linear-gradient(135deg,#10B981,#06B6D4)'
                                 : '#9AA3B2' }}>
                  {tk.status}
                </span>
              </div>

              {/* ── Date / Time / Location ────────────────── */}
              <div style={{ padding:'13px 16px 0',
                            display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 16px' }}>
                {[
                  { label:'Date',     value:tk.date     },
                  { label:'Time',     value:tk.time     },
                  { label:'Amount',   value: tk.amountPaid == null ? '–' : (tk.amountPaid === 0 ? 'Free' : `$${tk.amountPaid.toFixed(2)}`) },
                  { label:'Location', value:tk.location, full:true },
                ].map(row => (
                  <div key={row.label}
                    style={{ gridColumn: row.full ? '1 / -1' : 'auto' }}>
                    <div style={{ fontSize:12, fontWeight:600, color:C.subtle,
                                  textTransform:'uppercase', letterSpacing:0.3 }}>
                      {row.label}
                    </div>
                    <div style={{ fontSize:14.5, fontWeight:700, color:C.body, marginTop:3 }}>
                      {row.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Divider ───────────────────────────────── */}
              <div style={{ margin:'14px 16px 0', height:1,
                            background:'repeating-linear-gradient(90deg,#E8EBF0 0,#E8EBF0 6px,transparent 6px,transparent 12px)' }}/>

              {/* ── QR Code ───────────────────────────────── */}
              <div style={{ padding:'16px 16px 6px', display:'flex',
                            flexDirection:'column', alignItems:'center', gap:10 }}>
                <div style={{ background: isActive ? '#F4F8FF' : '#F4F6FA',
                              borderRadius:16, padding:14,
                              border: isActive ? `1.5px solid #D6EAFF` : `1.5px solid ${C.border}` }}>
                  <TicketQRCode value={tk.id} active={isActive} />
                </div>

                {/* Ticket ID */}
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:13,
                              color:C.subtle, letterSpacing:0.5 }}>
                  {tk.id}
                </div>

                {/* Active hint */}
                {isActive && (
                  <div style={{ display:'flex', alignItems:'center', gap:6,
                                background:'#E4F7EC', borderRadius:10,
                                padding:'7px 12px', width:'100%', boxSizing:'border-box' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="#10B981" strokeWidth="2"/>
                      <path d="m8 12 2.5 2.5L16 9" stroke="#10B981" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span style={{ fontSize:13, fontWeight:700, color:'#0E9F6E' }}>
                      Valid · Show QR at the door
                    </span>
                  </div>
                )}
              </div>

              {/* ── Action buttons ────────────────────────── */}
              <div style={{ padding:'10px 14px 16px', display:'flex', gap:9 }}>
                <button onClick={() => showToast('Added to calendar')}
                  style={{ flex:1, height:44, border:`1.5px solid ${C.border}`,
                           borderRadius:13, background:C.card, fontSize:14,
                           fontWeight:700, color:C.body, cursor:'pointer',
                           fontFamily:"'Montserrat',-apple-system,sans-serif",
                           display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <rect x="3.5" y="5" width="17" height="15.5" rx="3"
                          stroke={C.muted} strokeWidth="1.9"/>
                    <path d="M3.5 9.5h17M8 3v4M16 3v4"
                          stroke={C.muted} strokeWidth="1.9" strokeLinecap="round"/>
                  </svg>
                  Calendar
                </button>
                <button onClick={() => showToast('Sharing ticket…')}
                  style={{ flex:1, height:44, border:`1.5px solid ${C.border}`,
                           borderRadius:13, background:C.card, fontSize:14,
                           fontWeight:700, color:C.body, cursor:'pointer',
                           fontFamily:"'Montserrat',-apple-system,sans-serif",
                           display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <circle cx="18" cy="5.5" r="2.5" stroke={C.muted} strokeWidth="1.9"/>
                    <circle cx="6"  cy="12" r="2.5" stroke={C.muted} strokeWidth="1.9"/>
                    <circle cx="18" cy="18.5" r="2.5" stroke={C.muted} strokeWidth="1.9"/>
                    <path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"
                          stroke={C.muted} strokeWidth="1.9"/>
                  </svg>
                  Share
                </button>
                {tk.isPast && (
                  <button onClick={() => navigate('review',{ticketId:tk.id})}
                    style={{ flex:1, height:44, border:'none', borderRadius:13,
                             background:C.grad, fontSize:14, fontWeight:800,
                             color:'#fff', cursor:'pointer',
                             fontFamily:"'Montserrat',-apple-system,sans-serif",
                             display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                             boxShadow:'0 6px 16px rgba(2,162,240,0.28)' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.8 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3Z"
                            stroke="#fff" strokeWidth="1.8" strokeLinejoin="round"/>
                    </svg>
                    Review
                  </button>
                )}
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
}



// ─────────────────────────────────────────────────────────────
// SCREEN: CREATION SUCCESS (shared by Create Event/Space/Group)
// ─────────────────────────────────────────────────────────────
// A dedicated confirmation screen after creating an event/space/group,
// instead of just a toast + an immediate jump straight into the new
// content -- reuses TicketsScreen's existing checkmark/riplyPop pattern for
// visual consistency rather than inventing a second success animation.
const CREATION_KIND_CONFIG = {
  event: { noun: 'Event', verb: 'published', detailScreen: 'event-details', detailParam: 'eventId', rootScreen: 'home' },
  space: { noun: 'Space', verb: 'created',   detailScreen: 'space-details', detailParam: 'spaceId', rootScreen: 'spaces' },
  group: { noun: 'Group', verb: 'created',   detailScreen: 'group-profile', detailParam: 'groupId', rootScreen: 'discover' },
};
function CreationSuccessScreen({ kind, id, title, navigate, setScreen }) {
  const cfg = CREATION_KIND_CONFIG[kind] || CREATION_KIND_CONFIG.event;
  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column',
                    alignItems:'center', justifyContent:'center', padding:'40px 24px' }}>
        <div style={{ width:88, height:88, borderRadius:'50%', background:'#E4F7EC',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      animation:'riplyPop .5s cubic-bezier(.2,.8,.2,1)' }}>
          <div style={{ width:60, height:60, borderRadius:'50%',
                        background:'linear-gradient(135deg,#22C55E,#15A34A)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        boxShadow:'0 8px 20px rgba(21,163,74,0.4)' }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
              <path d="m5 12.5 4.5 4.5L19 7" stroke="#fff" strokeWidth="3"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
        <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.5, color:C.ink,
                      marginTop:20, textAlign:'center' }}>
          {cfg.noun} {cfg.verb}! 🎉
        </div>
        <div style={{ fontSize:15.5, lineHeight:1.55, color:'#7B8499',
                      textAlign:'center', marginTop:8, maxWidth:280 }}>
          "{title}" is live. Anyone browsing {kind === 'event' ? 'events' : kind === 'space' ? 'spaces' : 'groups'} can find it now.
        </div>

        <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:10, marginTop:28 }}>
          <button onClick={() => navigate(cfg.detailScreen, { [cfg.detailParam]: id })} style={{
            width:'100%', height:50, border:'none', borderRadius:15,
            background:'linear-gradient(135deg,#19BFFF,#008FF0)', color:'#fff',
            fontSize:16, fontWeight:800, cursor:'pointer',
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            boxShadow:'0 8px 20px rgba(2,162,240,0.4)' }}>
            View {cfg.noun}
          </button>
          <button onClick={() => setScreen(cfg.rootScreen)} style={{
            width:'100%', height:50, border:'none', borderRadius:15,
            background:'none', color:C.primary,
            fontSize:15.5, fontWeight:700, cursor:'pointer',
            fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
            Done
          </button>
        </div>
        <style>{`@keyframes riplyPop{0%{transform:scale(0.6);opacity:0;}60%{transform:scale(1.08);}100%{transform:scale(1);opacity:1;}}`}</style>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: CREATE CAMPUS GROUP
// ─────────────────────────────────────────────────────────────
function CreateGroupScreen({ goBack, navigate, showToast, currentUser }) {
  const CATS = [
    { id:'academic', label:'Academic' },
    { id:'sports',   label:'Sports'   },
    { id:'arts',     label:'Arts'     },
    { id:'social',   label:'Social'   },
    { id:'career',   label:'Career'   },
    { id:'culture',  label:'Culture'  },
    { id:'faith',    label:'Faith'    },
    { id:'wellness', label:'Wellness' },
  ];
  const GRADS = {
    academic:'linear-gradient(135deg,#2F6BFF,#6C4DF2)',
    sports:  'linear-gradient(135deg,#10B981,#06B6D4)',
    arts:    'linear-gradient(135deg,#FF5A8A,#FF8A3D)',
    social:  'linear-gradient(135deg,#FF6B6B,#FFB347)',
    career:  'linear-gradient(135deg,#0EA5E9,#0E84E0)',
    culture: 'linear-gradient(135deg,#7C5CFF,#B06BFF)',
    faith:   'linear-gradient(135deg,#0E9F6E,#06B6D4)',
    wellness:'linear-gradient(135deg,#F59E0B,#EF4444)',
  };
  const DEF_RULES = [
    'Be respectful and constructive',
    'Original work only — credit sources',
    'No spam or self-promotion',
    'Keep discussions on-topic',
  ];

  const [cat,      setCat]      = useState('culture');
  const [coverUrl,  setCoverUrl]  = useState(null);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name,     setName]     = useState('');
  const [privacy,  setPrivacy]  = useState('public');
  const [desc,     setDesc]     = useState('');
  const [meets,    setMeets]    = useState('');
  const [rules,    setRules]    = useState([...DEF_RULES]);
  const [draft,    setDraft]    = useState('');

  const coverGrad = GRADS[cat] || GRADS.culture;
  const initial   = (name.trim() ? name.trim()[0] : 'G').toUpperCase();
  const isPublic  = privacy === 'public';
  const canCreate = name.trim().length > 0;

  const Toggle = ({ value, onChange }) => (
    <button onClick={onChange} style={{
      width:44, height:26, border:'none', borderRadius:999, padding:0, flexShrink:0,
      background: value ? C.primary : '#D1D5DB', cursor:'pointer',
      position:'relative', transition:'background .2s',
    }}>
      <span style={{
        position:'absolute', top:3, left: value ? 21 : 3,
        width:20, height:20, borderRadius:'50%', background:'#fff',
        boxShadow:'0 1px 3px rgba(0,0,0,0.2)', transition:'left .2s', display:'block',
      }}/>
    </button>
  );

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background:C.pageBg,
                  fontFamily:"'Montserrat',-apple-system,sans-serif", position:'relative' }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)', backdropFilter:'blur(16px)',
                    padding:'50px 14px 13px', display:'flex', alignItems:'center', gap:9,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', zIndex:6 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none', borderRadius:13,
          background:C.chip, display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <path d="M14 6l-6 6 6 6" stroke={C.body} strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
                      letterSpacing:-0.4, color:C.ink }}>Create Campus Group</div>
        <div style={{ width:40 }} />
      </div>

      {/* ── Scroll body ────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', padding:'18px 16px 110px' }}>

        {/* Cover */}
        <button onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            setUploadingCover(true);
            try {
              const ext = safeExt(file.name);
              const url = await uploadImage(file, 'post-media', Date.now() + '.' + ext);
              setCoverUrl(url);
              showToast('Cover photo uploaded ✓');
            } catch {
              showToast('Upload failed. Try again.');
            }
            setUploadingCover(false);
            input.value = '';
          };
          input.click();
        }} style={{
          width:'100%', height:140, borderRadius:20,
          border: coverUrl ? 'none' : '2px dashed #C7D2E0',
          background: coverUrl ? '#000' : coverGrad, position:'relative', overflow:'hidden', cursor:'pointer',
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          gap:7, fontFamily:"'Montserrat',-apple-system,sans-serif",
        }}>
          {coverUrl && (
            <img src={coverUrl} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>
          )}
          <div style={{ position:'absolute', inset:0, background: coverUrl
            ? 'linear-gradient(to top,rgba(14,23,38,0.55) 0%,rgba(14,23,38,0.1) 60%,transparent 100%)'
            : 'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 16px)' }}/>
          <div style={{ width:42, height:42, borderRadius:13, background:'rgba(255,255,255,0.92)',
                        display:'flex', alignItems:'center', justifyContent:'center', position:'relative' }}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
              <rect x="3.5" y="6" width="17" height="13" rx="3" stroke={C.primary} strokeWidth="1.9"/>
              <circle cx="12" cy="12.5" r="3" stroke={C.primary} strokeWidth="1.9"/>
              <path d="M8.5 6l1-2h5l1 2" stroke={C.primary} strokeWidth="1.9" strokeLinejoin="round"/>
            </svg>
          </div>
          <span style={{ fontSize:14, fontWeight:800, color:'#fff', position:'relative' }}>
            {uploadingCover ? 'Uploading…' : coverUrl ? 'Change cover photo' : 'Add cover photo'}
          </span>
          {!coverUrl && !uploadingCover && (
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11,
                           color:'rgba(255,255,255,0.82)', position:'relative' }}>
              Recommended 1200×400
            </span>
          )}
        </button>

        {/* Group avatar preview */}
        <button onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            setUploadingAvatar(true);
            try {
              const ext = safeExt(file.name);
              const url = await uploadImage(file, 'post-media', Date.now() + '.' + ext);
              setAvatarUrl(url);
              showToast('Group icon uploaded ✓');
            } catch {
              showToast('Upload failed. Try again.');
            }
            setUploadingAvatar(false);
            input.value = '';
          };
          input.click();
        }} style={{
          display:'flex', alignItems:'center', gap:13, width:'100%', background:C.card,
          border:`1.5px solid ${C.border}`, borderRadius:16, padding:12, cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif", marginTop:12, textAlign:'left',
        }}>
          <div style={{ width:54, height:54, borderRadius:'50%', flexShrink:0,
                        background: avatarUrl ? 'transparent' : coverGrad, position:'relative', overflow:'hidden',
                        display:'flex', alignItems:'center', justifyContent:'center' }}>
            {avatarUrl
              ? <img src={avatarUrl} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>
              : <>
                  <div style={{ position:'absolute', inset:0, background:
                    'repeating-linear-gradient(135deg,rgba(255,255,255,0.14) 0,rgba(255,255,255,0.14) 2px,transparent 2px,transparent 9px)' }}/>
                  <span style={{ position:'relative', fontSize:24, fontWeight:800, color:'#fff' }}>
                    {initial}
                  </span>
                </>}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:15, fontWeight:800, color:C.ink }}>Group icon</div>
            <div style={{ fontSize:13, color:C.subtle, marginTop:2 }}>{uploadingAvatar ? 'Uploading…' : avatarUrl ? 'Tap to change logo' : 'Tap to upload a logo'}</div>
          </div>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <path d="M5 19h3l9-9-3-3-9 9v3Z" stroke={C.subtle} strokeWidth="1.8" strokeLinejoin="round"/>
            <path d="m14.5 6.5 3 3" stroke={C.subtle} strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Group Name */}
        <div style={{ marginTop:22 }}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
            Group Name
          </div>
          <div style={{ display:'flex', alignItems:'center', background:C.card,
                        border:`1.5px solid ${C.border}`, borderRadius:13,
                        padding:'0 15px', height:48 }}>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Photography Club"
              style={{ flex:1, border:'none', background:'none', outline:'none',
                       fontSize:15, fontWeight:700, color:C.body,
                       fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
            {name.trim().length > 0 && (
              <span style={{ fontSize:13, fontWeight:700, color:C.subtle, flexShrink:0 }}>
                {name.trim().length}/60
              </span>
            )}
          </div>
        </div>

        {/* Category */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:9 }}>
            Category
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {CATS.map(c => (
              <button key={c.id} onClick={() => setCat(c.id)} style={{
                flexShrink:0, height:34, padding:'0 14px', borderRadius:999, cursor:'pointer',
                border: c.id===cat ? 'none' : `1.5px solid ${C.border}`,
                fontSize:14, fontWeight:700,
                fontFamily:"'Montserrat',-apple-system,sans-serif",
                background: c.id===cat ? C.primary : C.card,
                color: c.id===cat ? '#fff' : C.muted,
                boxShadow: c.id===cat ? '0 4px 12px rgba(2,162,240,0.3)' : 'none',
              }}>{c.label}</button>
            ))}
          </div>
        </div>

        {/* Privacy */}
        <div style={{ marginTop:22 }}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:9 }}>
            Privacy
          </div>
          <div style={{ display:'flex', gap:9 }}>
            {[
              { id:'public',  label:'Public',  sub:'Anyone can find & join',
                icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke={isPublic?C.primary:'#9AA3B2'} strokeWidth="1.9"/><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" stroke={isPublic?C.primary:'#9AA3B2'} strokeWidth="1.9"/></svg> },
              { id:'private', label:'Private', sub:'Members need approval',
                icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4.5" y="10" width="15" height="10" rx="3" stroke={!isPublic?C.primary:'#9AA3B2'} strokeWidth="1.9"/><path d="M8 10V8a4 4 0 0 1 8 0v2" stroke={!isPublic?C.primary:'#9AA3B2'} strokeWidth="1.9"/></svg> },
            ].map(p => (
              <div key={p.id} onClick={() => setPrivacy(p.id)} style={{
                flex:1, display:'flex', alignItems:'center', gap:10, borderRadius:14,
                padding:'12px 13px', cursor:'pointer',
                background: privacy===p.id ? '#EAF6FF' : C.card,
                border: privacy===p.id ? `2px solid ${C.primary}` : `2px solid ${C.border}`,
                color: privacy===p.id ? C.primary : C.muted,
              }}>
                {p.icon}
                <div>
                  <div style={{ fontSize:15, fontWeight:800 }}>{p.label}</div>
                  <div style={{ fontSize:12, opacity:0.75, fontWeight:600, marginTop:2 }}>
                    {p.sub}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Description */}
        <div style={{ marginTop:22 }}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
            Description
          </div>
          <textarea value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="What is your group about? Who should join and what will you do together…"
            style={{ width:'100%', boxSizing:'border-box', minHeight:90,
                     border:`1.5px solid ${C.border}`, borderRadius:14, background:C.card,
                     padding:13, fontSize:14.5, fontWeight:500, lineHeight:1.6,
                     color:C.body, outline:'none', resize:'none',
                     fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
        </div>

        {/* Where you meet */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
            Where you meet
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10, background:C.card,
                        border:`1.5px solid ${C.border}`, borderRadius:13,
                        padding:'0 15px', height:46 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
              <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"
                    stroke={C.primary} strokeWidth="1.8"/>
              <circle cx="12" cy="10" r="2.4" stroke={C.primary} strokeWidth="1.8"/>
            </svg>
            <input value={meets} onChange={e => setMeets(e.target.value)}
              placeholder="e.g. University Centre, Tier 3"
              style={{ flex:1, border:'none', background:'none', outline:'none',
                       fontSize:14, fontWeight:600, color:C.body,
                       fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
          </div>
        </div>

        {/* Group Rules */}
        <div style={{ marginTop:22 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                        marginBottom:10 }}>
            <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                          textTransform:'uppercase', color:C.subtle }}>
              Group Rules
            </div>
            <span style={{ fontSize:12, fontWeight:700, color:C.subtle }}>
              {rules.length} rule{rules.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {rules.map((r, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, background:C.card,
                                     border:`1.5px solid ${C.border}`, borderRadius:13,
                                     padding:'10px 12px 10px 13px' }}>
                <div style={{ width:22, height:22, borderRadius:7, flexShrink:0,
                              display:'flex', alignItems:'center', justifyContent:'center',
                              background:'#E9F6FF', fontSize:13, fontWeight:800, color:C.primary }}>
                  {i + 1}
                </div>
                <span style={{ flex:1, fontSize:14, fontWeight:600, color:C.body,
                               lineHeight:1.4 }}>{r}</span>
                <button onClick={() => setRules(s => s.filter((_, idx) => idx !== i))} style={{
                  width:26, height:26, border:'none', borderRadius:8, background:C.chip,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  cursor:'pointer', flexShrink:0,
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M6 6l12 12M18 6L6 18" stroke={C.subtle} strokeWidth="2.2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Add custom rule */}
          <div style={{ display:'flex', gap:8, marginTop:9 }}>
            <input value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const t = draft.trim();
                  if (!t) return;
                  setRules(s => [...s, t]);
                  setDraft('');
                }
              }}
              placeholder="Add a custom rule…"
              style={{ flex:1, height:42, border:`1.5px solid ${C.border}`, borderRadius:12,
                       background:C.card, padding:'0 13px', fontSize:14, fontWeight:600,
                       color:C.body, outline:'none',
                       fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
            <button onClick={() => {
              const t = draft.trim();
              if (!t) { showToast('Type a rule first'); return; }
              setRules(s => [...s, t]);
              setDraft('');
            }} style={{ width:42, height:42, border:'none', borderRadius:12,
                        background:C.primary, display:'flex', alignItems:'center',
                        justifyContent:'center', cursor:'pointer',
                        boxShadow:'0 4px 10px rgba(2,162,240,0.3)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

      </div>{/* end scroll */}

      {/* ── Sticky Create bar ──────────────────────────────── */}
      <div style={{ position:'absolute', bottom:0, left:0, right:0, zIndex:6,
                    background:'rgba(255,255,255,0.96)', backdropFilter:'blur(16px)',
                    boxShadow:'0 -1px 0 rgba(16,24,40,0.07)', padding:'13px 16px 28px' }}>
        {!canCreate && (
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10,
                        background:'#FFF6EC', borderRadius:10, padding:'9px 12px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="#F59E0B" strokeWidth="2"/>
              <path d="M12 8v5M12 16h.01" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize:13, fontWeight:600, color:'#92400E' }}>
              Give your group a name to create it
            </span>
          </div>
        )}
        <button onClick={async () => {
          if (!canCreate) { showToast('Add a group name first'); return; }
          if (!currentUser.userId) { showToast('You must be logged in to create a group'); return; }
          setSubmitting(true);
          const { data: group, error } = await supabase.from('groups').insert({
            name: name.trim(),
            description: desc.trim(),
            privacy,
            category: [cat],
            logo_color: coverGrad,
            initial: name.trim()[0].toUpperCase(),
            admin_id: currentUser.userId,
            member_count: 1,
            post_count: 0,
            event_count: 0,
            rules,
            cover_url: coverUrl || null,
            avatar_url: avatarUrl || null,
          }).select().single();
          if (error) { setSubmitting(false); showToast('Failed to create group: ' + error.message); return; }
          // Add creator as first member with admin role
          await supabase.from('group_members').insert({
            group_id: group.id,
            user_id: currentUser.userId,
            role: 'admin',
          });
          setSubmitting(false);
          navigate('creation-success', { kind: 'group', id: group.id, title: name.trim() });
        }} style={{
          width:'100%', height:50, border:'none', borderRadius:15,
          cursor: canCreate && !submitting ? 'pointer' : 'not-allowed',
          background: canCreate ? 'linear-gradient(135deg,#19BFFF,#008FF0)' : '#C5CBD6',
          color:'#fff', fontSize:16, fontWeight:800,
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          display:'flex', alignItems:'center', justifyContent:'center', gap:9,
          boxShadow: canCreate ? '0 8px 20px rgba(2,162,240,0.4)' : 'none',
          opacity: submitting ? 0.7 : 1,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="8" cy="9" r="2.6" stroke="#fff" strokeWidth="1.9"/>
            <circle cx="16" cy="9" r="2.6" stroke="#fff" strokeWidth="1.9"/>
            <path d="M3.5 18c0-2.4 2-3.8 4.5-3.8M20.5 18c0-2.4-2-3.8-4.5-3.8M9 18c0-2 1.4-3.2 3-3.2s3 1.2 3 3.2"
                  stroke="#fff" strokeWidth="1.9" strokeLinecap="round"/>
          </svg>
          {submitting ? 'Creating…' : 'Create Group'}
          {canCreate && !submitting && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h13M13 6l6 6-6 6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: CREATE STUDENT SPACE
// ─────────────────────────────────────────────────────────────
function CreateSpaceScreen({ goBack, navigate, showToast, currentUser }) {
  const CATS = [
    { id:'academic', label:'Academic', grad:'linear-gradient(135deg,#7C5CFF,#B06BFF)' },
    { id:'social',   label:'Social',   grad:'linear-gradient(135deg,#FF5A8A,#FF8A3D)' },
    { id:'sports',   label:'Sports',   grad:'linear-gradient(135deg,#10B981,#06B6D4)' },
    { id:'arts',     label:'Arts',     grad:'linear-gradient(135deg,#FF6B6B,#FFB347)' },
    { id:'career',   label:'Career',   grad:'linear-gradient(135deg,#2F6BFF,#6C4DF2)' },
    { id:'culture',  label:'Culture',  grad:'linear-gradient(135deg,#7C5CFF,#02B6FE)' },
  ];

  const [cat,         setCat]        = useState('academic');
  const [title,       setTitle]      = useState('');
  const [firstDate,   setFirstDate]  = useState('');
  const [startTime,   setStartTime]  = useState('');
  const [duration,    setDuration]   = useState('');
  const [repeat,      setRepeat]     = useState(false);
  const [repeatWeeks, setRepeatWeeks]= useState('');
  const [venue,       setVenue]      = useState('');
  const [area,        setArea]       = useState('');
  const [maxSpots,    setMaxSpots]   = useState(10);
  const [notifySpot,  setNotifySpot] = useState(false);
  const [pricing,     setPricing]    = useState('free');
  const [price,       setPrice]      = useState('');
  const [about,       setAbout]      = useState('');
  const [coverUrl,    setCoverUrl]   = useState(null);
  const [uploading,   setUploading]  = useState(false);
  const [submitting,  setSubmitting] = useState(false);

  const activeCat  = CATS.find(c => c.id === cat) || CATS[0];
  const isPaid     = pricing === 'paid';
  const canCreate  = title.trim().length > 0;

  // reusable inline toggle
  const InlineToggle = ({ value, onChange }) => (
    <button onClick={onChange} style={{
      width:44, height:26, border:'none', borderRadius:999, padding:0, flexShrink:0,
      background: value ? C.primary : '#D1D5DB', cursor:'pointer',
      position:'relative', transition:'background .2s',
    }}>
      <span style={{
        position:'absolute', top:3, left: value ? 21 : 3,
        width:20, height:20, borderRadius:'50%', background:'#fff',
        boxShadow:'0 1px 3px rgba(0,0,0,0.2)', transition:'left .2s', display:'block',
      }}/>
    </button>
  );

  const SegBtn = ({ active, onClick, children }) => (
    <button onClick={onClick} style={{
      flex:1, height:44, cursor:'pointer',
      border: active ? 'none' : `1.5px solid ${C.border}`,
      borderRadius:12, fontSize:14, fontWeight:700,
      fontFamily:"'Montserrat',-apple-system,sans-serif",
      background: active ? C.primary : C.card,
      color: active ? '#fff' : C.muted,
      boxShadow: active ? '0 4px 12px rgba(2,162,240,0.3)' : 'none',
    }}>{children}</button>
  );

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif",
                  position:'relative' }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)',
                    backdropFilter:'blur(16px)', padding:'50px 14px 13px',
                    display:'flex', alignItems:'center', gap:9,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', zIndex:6 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none',
          borderRadius:13, background:C.chip, display:'flex', alignItems:'center',
          justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <path d="M14 6l-6 6 6 6" stroke={C.body} strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
                      letterSpacing:-0.4, color:C.ink }}>Create Student Space</div>
        <div style={{ width:40 }} />
      </div>

      {/* ── Scroll body ────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', padding:'18px 16px 110px' }}>

        {/* Cover */}
        <div onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            setUploading(true);
            try {
              const url = await uploadImage(file, 'post-media', Date.now() + '.jpg');
              setCoverUrl(url);
              showToast('Cover photo uploaded ✓');
            } catch {
              showToast('Upload failed. Try again.');
            }
            setUploading(false);
            input.value = '';
          };
          input.click();
        }}
          style={{ width:'100%', height:148, borderRadius:20,
                   border:'2px dashed #C7D2E0', background:activeCat.grad,
                   position:'relative', overflow:'hidden', cursor:'pointer',
                   display:'flex', flexDirection:'column',
                   alignItems:'center', justifyContent:'center', gap:8,
                   fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
          <div style={{ position:'absolute', inset:0, background:
            'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 16px)' }}/>
          <div style={{ width:44, height:44, borderRadius:14,
                        background:'rgba(255,255,255,0.9)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        position:'relative', zIndex:2 }}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
              <rect x="3.5" y="6" width="17" height="13" rx="3" stroke={C.primary} strokeWidth="1.9"/>
              <circle cx="12" cy="12.5" r="3" stroke={C.primary} strokeWidth="1.9"/>
              <path d="M8.5 6l1-2h5l1 2" stroke={C.primary} strokeWidth="1.9" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ fontSize:14, fontWeight:800, color:'#fff', position:'relative', zIndex:2 }}>
            {uploading ? 'Uploading…' : coverUrl ? 'Cover uploaded ✓' : 'Add space cover'}
          </div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11,
                        color:'rgba(255,255,255,0.85)', position:'relative', zIndex:2 }}>
            {coverUrl ? 'Tap to change' : 'Recommended 1200×630'}
          </div>
          {coverUrl && (
            <img src={coverUrl} style={{ position:'absolute', inset:0, width:'100%',
              height:'100%', objectFit:'cover', borderRadius:18, zIndex:1 }}/>
          )}
        </div>

        {/* Category */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:9 }}>
            Category
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {CATS.map(c => (
              <button key={c.id} onClick={() => setCat(c.id)} style={{
                flexShrink:0, height:34, padding:'0 15px', borderRadius:999,
                cursor:'pointer', border: c.id===cat ? 'none' : `1.5px solid ${C.border}`,
                fontSize:14, fontWeight:700,
                fontFamily:"'Montserrat',-apple-system,sans-serif",
                background: c.id===cat ? C.primary : C.card,
                color: c.id===cat ? '#fff' : C.muted,
                boxShadow: c.id===cat ? '0 4px 12px rgba(2,162,240,0.3)' : 'none',
              }}>{c.label}</button>
            ))}
          </div>
        </div>

        {/* Space Name */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
            Space Name
          </div>
          <div style={{ display:'flex', alignItems:'center', background:C.card,
                        border:`1.5px solid ${C.border}`, borderRadius:13,
                        padding:'0 14px', height:46 }}>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Seasonal Basketball 5v5"
              style={{ flex:1, border:'none', background:'none', outline:'none',
                       fontSize:15, fontWeight:600, color:C.body,
                       fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
          </div>
        </div>

        {/* Schedule */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
            Schedule
          </div>
          <div style={{ background:C.card, border:`1.5px solid ${C.border}`,
                        borderRadius:16, padding:'2px 14px' }}>
            {/* First date */}
            <div style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 0', borderBottom:`1px solid ${C.divider}` }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
                <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke={C.primary} strokeWidth="1.9"/>
                <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round"/>
              </svg>
              <span style={{ flex:1, fontSize:14, fontWeight:600, color:C.muted }}>First date</span>
              <input type="date" value={firstDate} onChange={e => setFirstDate(e.target.value)}
                style={{ border:'none', background:'none', fontSize:15, fontWeight:700,
                         color: firstDate ? C.body : C.muted, outline:'none', textAlign:'right',
                         fontFamily:"'Montserrat',-apple-system,sans-serif", colorScheme:'light' }}/>
            </div>
            {/* Start time */}
            <div style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 0', borderBottom:`1px solid ${C.divider}` }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
                <circle cx="12" cy="12" r="8.5" stroke={C.primary} strokeWidth="1.9"/>
                <path d="M12 8v4.5l3 2" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span style={{ flex:1, fontSize:14, fontWeight:600, color:C.muted }}>Start time</span>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                style={{ border:'none', background:'none', fontSize:15, fontWeight:700,
                         color: startTime ? C.body : C.muted, outline:'none', textAlign:'right',
                         fontFamily:"'Montserrat',-apple-system,sans-serif", colorScheme:'light' }}/>
            </div>
            {/* Duration */}
            <div style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 0' }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
                <circle cx="12" cy="13" r="7.5" stroke={C.primary} strokeWidth="1.9"/>
                <path d="M12 9.5v4l2.5 1.5" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 3h6M12 3v2.5" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round"/>
              </svg>
              <span style={{ flex:1, fontSize:14, fontWeight:600, color:C.muted }}>Duration</span>
              <select value={duration} onChange={e => setDuration(e.target.value)}
                style={{ border:'none', background:'none', fontSize:15, fontWeight:700,
                         color: duration ? C.body : C.muted, outline:'none', textAlign:'right',
                         fontFamily:"'Montserrat',-apple-system,sans-serif", cursor:'pointer' }}>
                <option value="">Select</option>
                {[30,45,60,75,90,120,150,180].map(m => (
                  <option key={m} value={`${m}`}>{m < 60 ? `${m} min` : `${m/60}h${m%60 ? ' '+m%60+'min' : ''}`}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Repeats weekly + number of weeks */}
          <div style={{ display:'flex', alignItems:'center', gap:9, marginTop:11 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M4 7l3-3 3 3M7 4v8a4 4 0 0 0 8 0V8a4 4 0 0 1 8 0v3"
                stroke={C.muted} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ flex:1, fontSize:14, fontWeight:600, color:C.muted }}>Repeats weekly</span>
            {repeat && (
              <div style={{ display:'flex', alignItems:'center', gap:6, marginRight:8 }}>
                <input
                  value={repeatWeeks} onChange={e => setRepeatWeeks(e.target.value.replace(/\D/g,''))}
                  placeholder="?"
                  inputMode="numeric"
                  style={{ width:36, height:26, border:`1.5px solid ${C.border}`, borderRadius:8,
                           background:C.card, textAlign:'center', fontSize:14, fontWeight:700,
                           color:C.body, outline:'none',
                           fontFamily:"'Montserrat',-apple-system,sans-serif" }}
                />
                <span style={{ fontSize:13, fontWeight:600, color:C.muted }}>wks</span>
              </div>
            )}
            <button onClick={() => setRepeat(v => !v)} style={{
              width:44, height:26, border:'none', borderRadius:999, padding:0,
              background: repeat ? C.primary : '#D1D5DB', cursor:'pointer',
              position:'relative', transition:'background .2s', flexShrink:0,
            }}>
              <span style={{ position:'absolute', top:3, left: repeat ? 21 : 3, width:20, height:20,
                             borderRadius:'50%', background:'#fff', display:'block',
                             boxShadow:'0 1px 3px rgba(0,0,0,0.2)', transition:'left .2s' }}/>
            </button>
          </div>
        </div>

        {/* Location */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
            Location
          </div>
          {/* Venue */}
          <div style={{ display:'flex', alignItems:'center', gap:10, background:C.card,
                        border:`1.5px solid ${C.border}`, borderRadius:13,
                        padding:'0 14px', height:46, marginBottom:9 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
              <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"
                    stroke={C.primary} strokeWidth="1.9"/>
              <circle cx="12" cy="10" r="2.4" stroke={C.primary} strokeWidth="1.9"/>
            </svg>
            <input value={venue} onChange={e => setVenue(e.target.value)}
              placeholder="Venue (e.g. Active Living Centre)"
              style={{ flex:1, border:'none', background:'none', outline:'none',
                       fontSize:14, fontWeight:600, color:C.body,
                       fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
          </div>
          {/* Court / Area */}
          <div style={{ display:'flex', alignItems:'center', gap:10, background:C.card,
                        border:`1.5px solid ${C.border}`, borderRadius:13,
                        padding:'0 14px', height:46 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
              <rect x="3" y="3" width="18" height="18" rx="3"
                    stroke={C.muted} strokeWidth="1.9"/>
              <path d="M3 9h18M9 21V9" stroke={C.muted} strokeWidth="1.9" strokeLinecap="round"/>
            </svg>
            <input value={area} onChange={e => setArea(e.target.value)}
              placeholder="Court / Area (e.g. Main Court · Fort Garry)"
              style={{ flex:1, border:'none', background:'none', outline:'none',
                       fontSize:14, fontWeight:600, color:C.body,
                       fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
          </div>
        </div>

        {/* Spots */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
            Spots
          </div>
          <div style={{ background:C.card, border:`1.5px solid ${C.border}`,
                        borderRadius:16, padding:'14px 16px' }}>
            {/* Stepper */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:15, fontWeight:700, color:C.body }}>
                Max participants
              </span>
              <div style={{ display:'flex', alignItems:'center', gap:13 }}>
                <button onClick={() => setMaxSpots(v => Math.max(2, v - 1))} style={{
                  width:32, height:32, border:'none', borderRadius:'50%',
                  background:'#E9ECF2', cursor:'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14" stroke="#39414F" strokeWidth="2.4" strokeLinecap="round"/>
                  </svg>
                </button>
                <span style={{ fontSize:18, fontWeight:800, color:C.ink,
                               minWidth:24, textAlign:'center' }}>
                  {maxSpots}
                </span>
                <button onClick={() => setMaxSpots(v => Math.min(99, v + 1))} style={{
                  width:32, height:32, border:'none', borderRadius:'50%',
                  background:C.primary, cursor:'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  boxShadow:'0 4px 10px rgba(2,162,240,0.3)',
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
            {/* Notify toggle */}
            <div style={{ display:'flex', alignItems:'center', gap:9, marginTop:13,
                          paddingTop:13, borderTop:`1px solid ${C.divider}` }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:15, fontWeight:700, color:C.body }}>
                  Notify when a spot opens
                </div>
                <div style={{ fontSize:13, color:C.subtle, marginTop:2 }}>
                  Alert waiting participants automatically
                </div>
              </div>
              <InlineToggle value={notifySpot} onChange={() => setNotifySpot(v => !v)}/>
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:9 }}>
            Pricing
          </div>
          <div style={{ display:'flex', gap:9 }}>
            <SegBtn active={!isPaid} onClick={() => setPricing('free')}>Free</SegBtn>
            <SegBtn active={ isPaid} onClick={() => setPricing('paid')}>Paid</SegBtn>
          </div>
          {isPaid && (
            <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:10,
                          background:C.card, border:`1.5px solid ${C.border}`,
                          borderRadius:13, padding:'0 14px', height:46 }}>
              <span style={{ fontSize:18, fontWeight:800, color:C.muted }}>$</span>
              <input value={price} onChange={e => setPrice(e.target.value)}
                placeholder="Price per spot (e.g. 5.00)"
                inputMode="decimal"
                style={{ flex:1, border:'none', background:'none', outline:'none',
                         fontSize:15, fontWeight:700, color:C.body,
                         fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
            </div>
          )}
        </div>

        {/* About */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
            About
          </div>
          <textarea value={about} onChange={e => setAbout(e.target.value)}
            placeholder="What is this space about? Who should join and what will you do…"
            style={{ width:'100%', boxSizing:'border-box', minHeight:88,
                     border:`1.5px solid ${C.border}`, borderRadius:14,
                     background:C.card, padding:14, fontSize:14.5, fontWeight:500,
                     lineHeight:1.6, color:C.body, outline:'none', resize:'none',
                     fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
        </div>

      </div>{/* end scroll */}

      {/* ── Sticky Create bar ──────────────────────────────── */}
      <div style={{ position:'absolute', bottom:0, left:0, right:0, zIndex:6,
                    background:'rgba(255,255,255,0.96)', backdropFilter:'blur(16px)',
                    boxShadow:'0 -1px 0 rgba(16,24,40,0.07)',
                    padding:'13px 16px 28px' }}>
        {!canCreate && (
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10,
                        background:'#FFF6EC', borderRadius:10, padding:'9px 12px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="#F59E0B" strokeWidth="2"/>
              <path d="M12 8v5M12 16h.01" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize:13, fontWeight:600, color:'#92400E' }}>
              Give your space a name to create it
            </span>
          </div>
        )}
        <button onClick={async () => {
          if (!canCreate) { showToast('Add a space name first'); return; }
          if (!currentUser.userId) { showToast('You must be logged in to create a space'); return; }
          setSubmitting(true);
          const activeCatObj = CATS.find(c => c.id === cat) || CATS[0];
          const location = [venue, area].filter(Boolean).join(' · ');
          // Compute ends_at from date + start time + duration (in hours)
          let endsAt = null;
          if (firstDate && startTime) {
            const start = new Date(`${firstDate}T${startTime}`);
            const hrs = parseFloat(duration) || 1;
            endsAt = new Date(start.getTime() + hrs * 3600000).toISOString();
          }
          const { data: space, error } = await supabase.from('spaces').insert({
            title: title.trim(),
            description: about.trim(),
            host_id: currentUser.userId,
            host_text: currentUser.name || 'Host',
            category: cat,
            location: location || null,
            time: startTime || null,
            duration: duration || null,
            repeat_weeks: repeat && repeatWeeks ? parseInt(repeatWeeks, 10) : null,
            price: isPaid ? (parseFloat(price) || 0) : 0,
            is_free: !isPaid,
            max_spots: maxSpots,
            participants: 1,
            started: false,
            day: firstDate || null,
            avatar_color: activeCatObj.grad,
            avatar_initial: title.trim()[0]?.toUpperCase() || 'S',
            ...(coverUrl ? { image_url: coverUrl } : {}),
            ...(endsAt ? { ends_at: endsAt } : {}),
          }).select().single();
          setSubmitting(false);
          if (error) { showToast('Failed to create space: ' + error.message); return; }
          navigate('creation-success', { kind: 'space', id: space.id, title: title.trim() });
        }} style={{
          width:'100%', height:50, border:'none', borderRadius:15,
          cursor: canCreate && !submitting ? 'pointer' : 'not-allowed',
          background: canCreate ? 'linear-gradient(135deg,#19BFFF,#008FF0)' : '#C5CBD6',
          color:'#fff', fontSize:16, fontWeight:800,
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          display:'flex', alignItems:'center', justifyContent:'center', gap:9,
          boxShadow: canCreate ? '0 8px 20px rgba(2,162,240,0.4)' : 'none',
          opacity: submitting ? 0.7 : 1,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="8.5" stroke="#fff" strokeWidth="2"/>
            <path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17"
                  stroke="#fff" strokeWidth="2"/>
          </svg>
          {submitting ? 'Creating…' : 'Create Space'}
          {canCreate && !submitting && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h13M13 6l6 6-6 6" stroke="#fff" strokeWidth="2.2"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </div>

    </div>
  );
}

function EventLabel({ children }) {
  return (
    <div style={{ fontSize:12, fontWeight:700, letterSpacing:0.4, textTransform:'uppercase',
                  color:C.subtle, marginBottom:7 }}>
      {children}
    </div>
  );
}

function EventInputField({ value, onChange, placeholder, inputMode, right }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, background:C.card,
                  border:`1.5px solid ${C.border}`, borderRadius:13, padding:'0 14px', height:46 }}>
      <input
        value={value} onChange={onChange} placeholder={placeholder} inputMode={inputMode}
        style={{ flex:1, border:'none', background:'none', outline:'none', fontSize:15,
                 fontWeight:600, color:C.body, fontFamily:"'Montserrat',-apple-system,sans-serif" }}
      />
      {right}
    </div>
  );
}

function EventRow({ children, last=false }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 0',
                  borderBottom: last ? 'none' : `1px solid ${C.divider}` }}>
      {children}
    </div>
  );
}

function EventSegBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      flex:1, height:44, border: active ? 'none' : `1.5px solid ${C.border}`,
      borderRadius:12, fontSize:14, fontWeight:700, cursor:'pointer',
      fontFamily:"'Montserrat',-apple-system,sans-serif",
      background: active ? C.primary : C.card,
      color: active ? '#fff' : C.muted,
      boxShadow: active ? '0 4px 12px rgba(2,162,240,0.3)' : 'none',
    }}>{children}</button>
  );
}

function EventCounterBtn({ onClick, minus }) {
  return (
    <button onClick={onClick} style={{
      width:32, height:32, border:'none', borderRadius:'50%', cursor:'pointer',
      display:'flex', alignItems:'center', justifyContent:'center',
      background: minus ? '#E9ECF2' : C.primary,
      boxShadow: minus ? 'none' : '0 4px 10px rgba(2,162,240,0.3)',
    }}>
      {minus
        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 12h14" stroke="#39414F" strokeWidth="2.4" strokeLinecap="round"/></svg>
        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/></svg>
      }
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: CREATE EVENT
// ─────────────────────────────────────────────────────────────
function CreateEventScreen({ goBack, navigate, showToast, currentUser, groupId: sourceGroupId, eventId }) {
  const isEditing = !!eventId;
  const CATS = [
    { id:'social',   label:'Social',   grad:'linear-gradient(135deg,#FF5A8A,#FF8A3D)' },
    { id:'career',   label:'Career',   grad:'linear-gradient(135deg,#2F6BFF,#6C4DF2)' },
    { id:'academic', label:'Academic', grad:'linear-gradient(135deg,#7C5CFF,#B06BFF)' },
    { id:'sports',   label:'Sports',   grad:'linear-gradient(135deg,#10B981,#06B6D4)' },
    { id:'festival', label:'Festival', grad:'linear-gradient(135deg,#FF6B6B,#FFB347)' },
  ];
  const PRESET_RULES = [
    'Have fun',
    'Be respectful of others',
    'Keep it safe and inclusive',
    'Follow venue guidelines',
    'Respect university policies',
  ];

  const [cat,       setCat]       = useState('social');
  const [title,     setTitle]     = useState('');
  const [date,        setDate]        = useState('');
  const [startTime,   setStartTime]   = useState('');
  const [endTime,     setEndTime]     = useState('');
  const [repeat,      setRepeat]      = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState('');
  const [venue,     setVenue]     = useState('');
  const [coverUrl,  setCoverUrl]  = useState(null);
  const [uploading, setUploading] = useState(false);
  const [room,      setRoom]      = useState('');
  const [pricing,   setPricing]   = useState('free');
  const [price,     setPrice]     = useState('');
  const [capacity,  setCapacity]  = useState(50);
  const [unlimited, setUnlimited] = useState(false);
  const [about,     setAbout]     = useState('');
  const [rules,     setRules]     = useState({});

  const [guests,     setGuests]     = useState([]);
  const [guestInput, setGuestInput] = useState({ name:'', role:'' });

  const addGuest = () => {
    if (!guestInput.name.trim()) return;
    setGuests(g => [...g, { name: guestInput.name.trim(), role: guestInput.role.trim() }]);
    setGuestInput({ name:'', role:'' });
  };
  const removeGuest = (i) => setGuests(g => g.filter((_, idx) => idx !== i));

  const [isPublic,   setIsPublic]   = useState(true);
  // Tracks *which* action is in flight ('draft' | 'published' | null) so each
  // button can show its own "…ing" label instead of both going stale together.
  const [submittingStatus, setSubmittingStatus] = useState(null);
  const submitting = !!submittingStatus;
  const activeCat = CATS.find(c => c.id === cat) || CATS[0];
  const isPaid = pricing === 'paid';
  const canPublish = title.trim().length > 0;

  // Edit mode: load the existing event and prefill every field. originalPrice
  // is kept around (not just displayed) so submitEvent can tell whether the
  // organizer actually changed it and only then notify ticket holders.
  const [loadingEvent, setLoadingEvent] = useState(isEditing);
  const [originalPrice, setOriginalPrice] = useState(null);
  const [eventStatus, setEventStatus] = useState('published');
  // The event-manager's edit button only passes eventId, not groupId, so a
  // group-owned draft opened from there would otherwise look group-less here
  // (sourceGroupId undefined) and silently skip the group announcement post
  // + event_count bump on publish. Falls back to the loaded event's own
  // group_id whenever the nav param didn't supply one.
  const [loadedGroupId, setLoadedGroupId] = useState(null);
  const effectiveGroupId = sourceGroupId || loadedGroupId;

  // Converts a stored "6:00 PM"-style string back to the 24-hour "18:00"
  // a native <input type="time"> needs to show it as prefilled.
  const to24Hr = (t12) => {
    const m = String(t12 || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return '';
    let h = parseInt(m[1], 10);
    const min = m[2];
    const ampm = m[3].toUpperCase();
    if (ampm === 'AM') { if (h === 12) h = 0; } else if (h !== 12) { h += 12; }
    return `${String(h).padStart(2, '0')}:${min}`;
  };

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      const { data: ev, error } = await supabase.from('events').select('*').eq('id', eventId).single();
      if (cancelled) return;
      if (error || !ev) {
        showToast('Could not load event');
        goBack();
        return;
      }
      setCat(ev.category || 'social');
      setTitle(ev.title || '');
      setDate(ev.date || ev.full_date || '');
      setStartTime(to24Hr(ev.start_time));
      const [, endLabel] = (ev.time_range || '').split(' – ');
      setEndTime(to24Hr(endLabel));
      setRepeat(!!ev.repeat_weeks);
      setRepeatWeeks(ev.repeat_weeks ? String(ev.repeat_weeks) : '');
      setVenue(ev.venue || '');
      setRoom(ev.room || '');
      setCoverUrl(ev.image_url || null);
      const parsedPrice = parseEventPrice(ev.price);
      setPricing(parsedPrice.isFree ? 'free' : 'paid');
      setPrice(parsedPrice.isFree ? '' : String(parsedPrice.amount));
      setOriginalPrice(parsedPrice.isFree ? 0 : parsedPrice.amount);
      setUnlimited(ev.capacity == null);
      setCapacity(ev.capacity ?? 50);
      setAbout(ev.description || ev.full_desc || '');
      setRules(Object.fromEntries((ev.rules || []).map(r => [r, true])));
      setGuests(ev.guests || []);
      setIsPublic(ev.is_public !== false);
      setEventStatus(ev.status || 'published');
      setLoadedGroupId(ev.group_id || null);
      setLoadingEvent(false);
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const handleCancelEvent = async () => {
    if (!window.confirm(`Cancel "${title}"? Everyone with a ticket will be notified. This can't be undone.`)) return;
    setSubmittingStatus('cancel');
    const { error } = await supabase.from('events').update({ status: 'cancelled' }).eq('id', eventId);
    if (error) { setSubmittingStatus(null); showToast('Failed to cancel: ' + error.message); return; }
    const { error: notifErr } = await supabase.rpc('notify_event_change', { p_event_id: eventId, p_change_type: 'cancelled' });
    if (notifErr) console.error('[handleCancelEvent] notify failed:', notifErr);
    setSubmittingStatus(null);
    showToast('Event cancelled');
    navigate('event-manager');
  };

  const submitEvent = async (status) => {
    if (!canPublish) { showToast('Add an event title first'); return; }
    if (!currentUser.userId) { showToast('You must be logged in to save an event'); return; }
    if ((status === 'published' || status === 'pending') && isPaid && parseEventPrice(price).amount <= 0) {
      showToast('Enter a valid ticket price');
      return;
    }
    setSubmittingStatus(status);
    const location = [venue, room].filter(Boolean).join(' · ');
    const timeRange = [startTime, endTime].filter(Boolean).map(fmt12).join(' – ');
    const selectedRules = Object.entries(rules).filter(([,v])=>v).map(([k])=>k);
    const newPrice = isPaid ? parseEventPrice(price).amount : 0;
    const sharedFields = {
      title: title.trim(),
      description: about.trim(),
      full_desc: about.trim(),
      category: cat,
      tags: [cat],
      location: location || null,
      venue: venue.trim() || null,
      room: room.trim() || null,
      date: date || null,
      full_date: date || null,
      start_time: startTime ? fmt12(startTime) : null,
      time_range: timeRange || null,
      repeat_weeks: repeat && repeatWeeks ? parseInt(repeatWeeks, 10) : null,
      image_url: coverUrl || null,
      // Store a clean numeric string, not a raw `$`-prefixed user
      // string — every read site parses this defensively, but no
      // need to bake a display artifact into the stored value.
      // parseEventPrice (not a bare parseFloat) so a user who typed
      // "$15" into the field doesn't silently become a free event.
      price: isPaid ? String(newPrice) : 'Free',
      capacity: unlimited ? null : capacity,
      badge: repeat ? (() => { try { const d = new Date(date); return isNaN(d) ? 'Every Week' : 'Every ' + d.toLocaleDateString('en-US',{weekday:'long'}); } catch { return 'Every Week'; } })() : null,
      rules: selectedRules.length ? selectedRules : null,
      guests: guests.length ? guests : null,
      // Was missing entirely before, so editing a draft and clicking
      // "Publish Event" updated every other field but silently left the
      // row's status as 'draft' forever -- the create-mode insert set
      // status separately below, but the edit-mode .update() call uses
      // sharedFields directly and needs it here too.
      status,
    };

    let event, error;
    if (isEditing) {
      // Editing never touches attendee_count/likes/saves/shares/trending --
      // those are live counters this screen has no business resetting.
      ({ data: event, error } = await supabase.from('events')
        .update(sharedFields)
        .eq('id', eventId)
        .select().single());
    } else {
      ({ data: event, error } = await supabase.from('events').insert({
        ...sharedFields,
        user_id: currentUser.userId,
        org: currentUser.name || 'Organizer',
        org_initial: (currentUser.name || 'O')[0].toUpperCase(),
        attendee_count: 0,
        likes: 0,
        saves: 0,
        shares: 0,
        trending: false,
        group_id: effectiveGroupId || null,
        is_public: effectiveGroupId ? isPublic : true,
      }).select().single());
    }
    if (error) { setSubmittingStatus(null); showToast(`Failed to ${isEditing ? 'save changes' : status === 'draft' ? 'save draft' : 'publish'}: ` + error.message); return; }

    // A draft leaving draft status (submitted for approval, or published
    // directly) still needs the tail logic below -- only a plain edit-mode
    // save that isn't changing the draft's status should return early here.
    const isLeavingDraft = isEditing && eventStatus === 'draft' && status !== 'draft';

    if (isEditing) {
      // Only notify ticket holders if the price actually changed -- not on
      // every unrelated edit (fixing a typo in the description shouldn't
      // spam everyone who bought a ticket).
      if (originalPrice !== null && newPrice !== originalPrice) {
        const detail = newPrice === 0 ? 'now free' : `now $${newPrice.toFixed(2)}`;
        const { error: notifErr } = await supabase.rpc('notify_event_change', {
          p_event_id: eventId, p_change_type: 'price_changed', p_detail: detail,
        });
        if (notifErr) console.error('[submitEvent] price-change notify failed:', notifErr);
      }
      if (!isLeavingDraft) {
        setSubmittingStatus(null);
        showToast('Changes saved');
        navigate('event-details', { eventId });
        return;
      }
    }

    // Drafts aren't visible to anyone else yet, so skip the group
    // announcement post entirely -- only a published event should notify.
    if (status === 'published' && effectiveGroupId && event) {
      // Event-alert posts read as an announcement from the group itself,
      // not a personal post from whichever member happened to create the
      // event -- so attribute it to the group's own name/avatar rather
      // than currentUser (unlike CreatePostScreen's regular posts, which
      // are correctly attributed to the actual poster).
      const { data: groupRow } = await supabase.from('groups')
        .select('name, avatar_url, logo_color').eq('id', effectiveGroupId).single();
      const authorName = groupRow?.name || 'Group';
      const eventPostText = `📆🚨 New Event Alert: ${title.trim()}${about.trim() ? '\n' + about.trim() : ''}`;
      // Not checked before: if this group has "members can post" turned off,
      // a non-admin member creating an event here would have this insert
      // silently rejected by posts_insert's RLS (membersPost/admin check) --
      // the event itself still publishes fine, but the announcement post
      // just vanishes with no feedback that it never made it to the feed.
      const { error: announceError } = await supabase.from('posts').insert({
        group_id:           effectiveGroupId,
        user_id:            currentUser.userId,
        content:            eventPostText,
        text:               eventPostText,
        image_url:          coverUrl || null,
        linked_event_id:    event.id,
        linked_event_title: title.trim(),
        linked_event_date:  fmtDate(date) || null,
        linked_event_time:  timeRange || null,
        likes_count:        0,
        comment_count:      0,
        author_name:        authorName,
        author_initial:     authorName[0]?.toUpperCase() || 'G',
        author_color:       groupRow?.logo_color || deriveAvatarColor(effectiveGroupId),
        avatar_url:         groupRow?.avatar_url || null,
        author_is_group:    true,
      });
      if (announceError) {
        console.error('[submitEvent] group announcement post failed:', announceError);
        showToast('Event published, but the group announcement post could not be posted');
      }
      // increment event_count via RPC: groups.update() is admin-only
      // now, so this (a member, not necessarily the admin, posting an
      // event) goes through a security-definer function scoped to
      // just this counter.
      await supabase.rpc('increment_group_event_count', { p_group_id: effectiveGroupId });
    }
    setSubmittingStatus(null);
    if (status === 'draft') {
      showToast('Draft saved');
      navigate('event-manager');
    } else if (status === 'pending') {
      showToast('Submitted for approval — an admin will review it before it goes live');
      navigate('event-manager');
    } else if (isLeavingDraft) {
      showToast('Event published');
      navigate('event-details', { eventId });
    } else {
      navigate('creation-success', { kind: 'event', id: event.id, title: title.trim() });
    }
  };

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background:C.pageBg,
                  fontFamily:"'Montserrat',-apple-system,sans-serif", position:'relative' }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)', backdropFilter:'blur(16px)',
                    padding:'50px 14px 13px', display:'flex', alignItems:'center', gap:9,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', zIndex:6 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none', borderRadius:13,
          background:C.chip, display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <path d="M14 6l-6 6 6 6" stroke={C.body} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
                      letterSpacing:-0.4, color:C.ink }}>{isEditing ? 'Edit Event' : 'Create Event'}</div>
        <div style={{ width:40 }} />
      </div>

      {loadingEvent ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ width:36, height:36, borderRadius:'50%', border:'3.5px solid #E1E6EE',
                        borderTopColor:C.primary, animation:'riplySpin .8s linear infinite' }}/>
          <style>{`@keyframes riplySpin{to{transform:rotate(360deg);}}`}</style>
        </div>
      ) : (
      <>
      {/* ── Scroll body ────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', padding:'18px 16px 110px' }}>

        {/* Cover */}
        <div onClick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            setUploading(true);
            try {
              const url = await uploadImage(file, 'post-media', `${Date.now()}.jpg`);
              setCoverUrl(url);
              showToast('Cover photo uploaded ✓');
            } catch {
              showToast('Upload failed. Try again.');
            }
           setUploading(false);
            input.value = '';
          };
          input.click();
        }}
          style={{ width:'100%', height:155, borderRadius:20, border:'2px dashed #C7D2E0',
                   background: activeCat.grad,
                   cursor:'pointer', display:'flex', flexDirection:'column',
                   alignItems:'center', justifyContent:'center', gap:9,
                   fontFamily:"'Montserrat',-apple-system,sans-serif",
                   position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', inset:0, background:
            'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 16px)' }}/>
          <div style={{ width:46, height:46, borderRadius:14, background:'rgba(255,255,255,0.9)',
                        display:'flex', alignItems:'center', justifyContent:'center', position:'relative', zIndex:2 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="3.5" y="6" width="17" height="13" rx="3" stroke={C.primary} strokeWidth="1.9"/>
              <circle cx="12" cy="12.5" r="3" stroke={C.primary} strokeWidth="1.9"/>
              <path d="M8.5 6l1-2h5l1 2" stroke={C.primary} strokeWidth="1.9" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ fontSize:14.5, fontWeight:800, color:'#fff', position:'relative' }}>
            {uploading ? 'Uploading…' : coverUrl ? 'Cover uploaded ✓' : 'Add cover photo'}
          </div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11.5,
                        color:'rgba(255,255,255,0.85)', position:'relative' }}>
            {coverUrl ? 'Tap to change' : 'Recommended 1200×630'}
          </div>
          {coverUrl && (
            <img src={coverUrl} style={{ position:'absolute', top:0, left:0, width:'100%',
              height:'155px', objectFit:'cover', borderRadius:18, zIndex:1 }}/>
          )}
        </div>
        {/* Category */}
        <div style={{ marginTop:20 }}>
          <EventLabel>Category</EventLabel>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {CATS.map(c => (
              <button key={c.id} onClick={() => setCat(c.id)} style={{
                flexShrink:0, border: c.id===cat ? 'none' : `1.5px solid ${C.border}`,
                cursor:'pointer', height:36, padding:'0 16px', borderRadius:999,
                fontSize:14, fontWeight:700,
                fontFamily:"'Montserrat',-apple-system,sans-serif",
                background: c.id===cat ? C.primary : C.card,
                color: c.id===cat ? '#fff' : C.muted,
                boxShadow: c.id===cat ? '0 4px 12px rgba(2,162,240,0.3)' : 'none',
              }}>{c.label}</button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div style={{ marginTop:20 }}>
          <EventLabel>Event Title</EventLabel>
          <div style={{ display:'flex', alignItems:'center', gap:10, background:C.card,
                        border:`1.5px solid ${C.border}`, borderRadius:13, padding:'0 14px', height:46 }}>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Karaoke Night"
              autoComplete="off"
              style={{ flex:1, border:'none', background:'none', outline:'none', fontSize:15,
                       fontWeight:600, color:C.body, fontFamily:"'Montserrat',-apple-system,sans-serif" }}
            />
          </div>
        </div>

        {/* Date & Time */}
        <div style={{ marginTop:20 }}>
          <EventLabel>Date &amp; Time</EventLabel>
          <div style={{ background:C.card, border:`1.5px solid ${C.border}`, borderRadius:16, padding:'2px 14px' }}>
            {[
              { label:'Date',       icon:'cal',   val:date,      set:setDate,      type:'date' },
              { label:'Start time', icon:'clock', val:startTime, set:setStartTime, type:'time' },
              { label:'End time',   icon:'clock', val:endTime,   set:setEndTime,   type:'time', last:true },
            ].map((r) => (
              <div key={r.label} style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 0',
                                          borderBottom: r.last ? 'none' : `1px solid ${C.divider}` }}>
                {r.icon === 'cal'
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
                      <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke={C.primary} strokeWidth="1.9"/>
                      <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round"/>
                    </svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
                      <circle cx="12" cy="12" r="8.5" stroke={C.primary} strokeWidth="1.9"/>
                      <path d="M12 8v4.5l3 2" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                }
                <span style={{ flex:1, fontSize:14, fontWeight:600, color:C.muted }}>{r.label}</span>
                <input
                  type={r.type} value={r.val} onChange={e => r.set(e.target.value)}
                  style={{ border:'none', background:'none', fontSize:15, fontWeight:700,
                           color: r.val ? C.body : C.muted, outline:'none', textAlign:'right',
                           fontFamily:"'Montserrat',-apple-system,sans-serif", colorScheme:'light' }}
                />
              </div>
            ))}
          </div>
          {/* Repeats weekly */}
          <div style={{ display:'flex', alignItems:'center', gap:9, marginTop:11 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M4 7l3-3 3 3M7 4v8a4 4 0 0 0 8 0V8a4 4 0 0 1 8 0v3"
                stroke={C.muted} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ flex:1, fontSize:14, fontWeight:600, color:C.muted }}>Repeats weekly</span>
            {repeat && (
              <div style={{ display:'flex', alignItems:'center', gap:6, marginRight:8 }}>
                <input value={repeatWeeks} onChange={e => setRepeatWeeks(e.target.value.replace(/\D/g,''))}
                  placeholder="?" inputMode="numeric"
                  style={{ width:36, height:26, border:`1.5px solid ${C.border}`, borderRadius:8,
                           background:C.card, textAlign:'center', fontSize:14, fontWeight:700,
                           color:C.body, outline:'none', fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
                <span style={{ fontSize:13, fontWeight:600, color:C.muted }}>wks</span>
              </div>
            )}
            <button onClick={() => setRepeat(v => !v)} style={{
              width:44, height:26, border:'none', borderRadius:999, padding:0,
              background: repeat ? C.primary : '#D1D5DB', cursor:'pointer',
              position:'relative', transition:'background .2s', flexShrink:0,
            }}>
              <span style={{ position:'absolute', top:3, left: repeat ? 21 : 3, width:20, height:20,
                             borderRadius:'50%', background:'#fff', display:'block',
                             boxShadow:'0 1px 3px rgba(0,0,0,0.2)', transition:'left .2s' }}/>
            </button>
          </div>
        </div>

        {/* Location */}
        <div style={{ marginTop:20 }}>
          <EventLabel>Location</EventLabel>
          <div style={{ display:'flex', alignItems:'center', gap:10, background:C.card,
                        border:`1.5px solid ${C.border}`, borderRadius:13, padding:'0 14px', height:46, marginBottom:9 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
              <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" stroke={C.primary} strokeWidth="1.9"/>
              <circle cx="12" cy="10" r="2.4" stroke={C.primary} strokeWidth="1.9"/>
            </svg>
            <input value={venue} onChange={e => setVenue(e.target.value)}
              placeholder="Venue name (e.g. UMSU University Centre)"
              style={{ flex:1, border:'none', background:'none', outline:'none', fontSize:14,
                       fontWeight:600, color:C.body, fontFamily:"'Montserrat',-apple-system,sans-serif" }}
            />
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10, background:C.card,
                        border:`1.5px solid ${C.border}`, borderRadius:13, padding:'0 14px', height:46 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
              <rect x="3" y="3" width="18" height="18" rx="3" stroke={C.muted} strokeWidth="1.9"/>
              <path d="M3 9h18M9 21V9" stroke={C.muted} strokeWidth="1.9" strokeLinecap="round"/>
            </svg>
            <input value={room} onChange={e => setRoom(e.target.value)}
              placeholder="Floor / Room (e.g. 3rd Floor · Multipurpose Room)"
              style={{ flex:1, border:'none', background:'none', outline:'none', fontSize:14,
                       fontWeight:600, color:C.body, fontFamily:"'Montserrat',-apple-system,sans-serif" }}
            />
          </div>
        </div>

        {/* Pricing */}
        <div style={{ marginTop:20 }}>
          <EventLabel>Pricing</EventLabel>
          <div style={{ display:'flex', gap:9 }}>
            <EventSegBtn active={!isPaid} onClick={() => setPricing('free')}>Free for students</EventSegBtn>
            <EventSegBtn active={ isPaid} onClick={() => setPricing('paid')}>Paid</EventSegBtn>
          </div>
          {isPaid && (
            <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:10, background:C.card,
                          border:`1.5px solid ${C.border}`, borderRadius:13, padding:'0 14px', height:46 }}>
              <span style={{ fontSize:18, fontWeight:800, color:C.muted }}>$</span>
              <input value={price} onChange={e => setPrice(e.target.value)}
                placeholder="Price per ticket (e.g. 15.00)"
                inputMode="decimal" type="text"
                style={{ flex:1, border:'none', background:'none', outline:'none', fontSize:15,
                         fontWeight:700, color:C.body, fontFamily:"'Montserrat',-apple-system,sans-serif" }}
              />
            </div>
          )}
        </div>

        {/* Capacity */}
        <div style={{ marginTop:20 }}>
          <EventLabel>Capacity</EventLabel>
          <div style={{ background:C.card, border:`1.5px solid ${C.border}`, borderRadius:16, padding:'14px 16px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:15, fontWeight:700, color:C.body }}>Max attendees</span>
              <div style={{ display:'flex', alignItems:'center', gap:13 }}>
                <EventCounterBtn minus onClick={() => !unlimited && setCapacity(v => Math.max(10, v - 10))}/>
                <span style={{ fontSize:18, fontWeight:800, color:C.ink, minWidth:34, textAlign:'center' }}>
                  {unlimited ? '∞' : capacity}
                </span>
                <EventCounterBtn onClick={() => !unlimited && setCapacity(v => v + 10)}/>
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:9, marginTop:13,
                          paddingTop:13, borderTop:`1px solid ${C.divider}` }}>
              <span style={{ flex:1, fontSize:14, fontWeight:600, color:C.muted }}>Unlimited capacity</span>
              <button onClick={() => setUnlimited(v => !v)} style={{
                width:44, height:26, border:'none', borderRadius:999, padding:0,
                background: unlimited ? C.primary : '#D1D5DB', cursor:'pointer',
                position:'relative', transition:'background .2s', flexShrink:0,
              }}>
                <span style={{ position:'absolute', top:3, left: unlimited ? 21 : 3, width:20, height:20,
                               borderRadius:'50%', background:'#fff', display:'block',
                               boxShadow:'0 1px 3px rgba(0,0,0,0.2)', transition:'left .2s' }}/>
              </button>
            </div>
          </div>
        </div>

        {/* About */}
        <div style={{ marginTop:20 }}>
          <EventLabel>About</EventLabel>
          <textarea
            value={about} onChange={e => setAbout(e.target.value)}
            placeholder="Describe your event — who should come, what to expect, what to bring…"
            style={{ width:'100%', boxSizing:'border-box', minHeight:96,
                     border:`1.5px solid ${C.border}`, borderRadius:14, background:C.card,
                     padding:14, fontSize:14.5, fontWeight:500, lineHeight:1.6,
                     color:C.body, outline:'none', resize:'none',
                     fontFamily:"'Montserrat',-apple-system,sans-serif" }}
          />
        </div>

        {/* Guest List */}
        <div style={{ marginTop:20 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <EventLabel>Guest List</EventLabel>
            <span style={{ fontSize:12, fontWeight:700, color:C.subtle }}>{guests.length} added</span>
          </div>
          {/* Existing guests */}
          {guests.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:11 }}>
              {guests.map((g, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:11, background:C.card,
                                      border:`1.5px solid ${C.border}`, borderRadius:13, padding:'10px 14px' }}>
                  <div style={{ width:34, height:34, borderRadius:10, flexShrink:0,
                                background:'linear-gradient(135deg,#7C5CFF,#B06BFF)',
                                display:'flex', alignItems:'center', justifyContent:'center',
                                color:'#fff', fontSize:15, fontWeight:800 }}>
                    {g.name[0].toUpperCase()}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:14.5, fontWeight:700, color:C.body,
                                  whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{g.name}</div>
                    {g.role && <div style={{ fontSize:12.5, color:C.subtle, marginTop:1 }}>{g.role}</div>}
                  </div>
                  <button onClick={() => removeGuest(i)} style={{ border:'none', background:'none',
                    padding:4, cursor:'pointer', color:'#9AA3B2', flexShrink:0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Add guest inputs */}
          <div style={{ background:C.card, border:`1.5px solid ${C.border}`, borderRadius:16, padding:'2px 14px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 0',
                          borderBottom:`1px solid ${C.divider}` }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
                <circle cx="12" cy="8" r="3.5" stroke={C.primary} strokeWidth="1.9"/>
                <path d="M4.5 20c0-3.5 3-5.5 7.5-5.5s7.5 2 7.5 5.5" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round"/>
              </svg>
              <input value={guestInput.name} onChange={e => setGuestInput(s => ({...s, name: e.target.value}))}
                placeholder="Guest name"
                style={{ flex:1, border:'none', background:'none', outline:'none', fontSize:14.5,
                         fontWeight:600, color:C.body, fontFamily:"'Montserrat',-apple-system,sans-serif" }}
              />
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 0' }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
                <path d="M4 6h10M4 12h10M4 18h6" stroke={C.muted} strokeWidth="1.9" strokeLinecap="round"/>
              </svg>
              <input value={guestInput.role} onChange={e => setGuestInput(s => ({...s, role: e.target.value}))}
                onKeyDown={e => e.key === 'Enter' && addGuest()}
                placeholder="Role (e.g. MC, DJ, Live Band)"
                style={{ flex:1, border:'none', background:'none', outline:'none', fontSize:14.5,
                         fontWeight:600, color:C.body, fontFamily:"'Montserrat',-apple-system,sans-serif" }}
              />
            </div>
          </div>
          <button onClick={addGuest} style={{
            marginTop:9, width:'100%', height:40, border:`1.5px solid ${C.border}`,
            borderRadius:12, background:C.card, fontSize:14, fontWeight:700,
            color: guestInput.name.trim() ? C.primary : C.subtle,
            cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
            </svg>
            Add Guest
          </button>
        </div>

        {/* Rules */}
        <div style={{ marginTop:20 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <EventLabel>Rules &amp; Guidelines</EventLabel>
            <span style={{ fontSize:12, fontWeight:700, color:C.subtle }}>
              {Object.values(rules).filter(Boolean).length} selected
            </span>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {PRESET_RULES.map(r => {
              const on = !!rules[r];
              return (
                <div key={r} onClick={() => setRules(s => ({ ...s, [r]: !s[r] }))}
                  style={{ display:'flex', alignItems:'center', gap:12, cursor:'pointer',
                            background: on ? '#EAF6FF' : C.card,
                            border: on ? `1.5px solid ${C.primary}` : `1.5px solid ${C.border}`,
                            borderRadius:13, padding:'11px 14px', transition:'all .15s' }}>
                  <div style={{ width:22, height:22, borderRadius:7, flexShrink:0,
                                display:'flex', alignItems:'center', justifyContent:'center',
                                background: on ? C.primary : C.card,
                                border: on ? 'none' : `2px solid ${C.border}` }}>
                    {on && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="M5 12.5l4.5 4.5L19 7" stroke="#fff" strokeWidth="3"
                              strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <span style={{ fontSize:14, fontWeight:600, color: on ? C.body : '#7B8499' }}>{r}</span>
                </div>
              );
            })}
          </div>
        </div>

      </div>{/* end scroll */}

      {/* ── Sticky Publish bar ─────────────────────────────── */}
      <div style={{ position:'absolute', bottom:0, left:0, right:0, zIndex:6,
                    background:'rgba(255,255,255,0.96)', backdropFilter:'blur(16px)',
                    boxShadow:'0 -1px 0 rgba(16,24,40,0.07)', padding:'13px 16px 28px' }}>
        {/* Visibility toggle (only when creating from a group) */}
        {effectiveGroupId && (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                        background:C.chip, borderRadius:13, padding:'11px 14px', marginBottom:12 }}>
            <div>
              <div style={{ fontSize:15, fontWeight:800, color:C.ink }}>
                {isPublic ? 'Public event' : 'Group-only event'}
              </div>
              <div style={{ fontSize:13, color:C.subtle, marginTop:2 }}>
                {isPublic ? 'Visible on the home feed for everyone' : 'Only visible inside this group'}
              </div>
            </div>
            <div onClick={() => setIsPublic(p => !p)}
              style={{ width:44, height:26, borderRadius:999, cursor:'pointer', flexShrink:0,
                       background: isPublic ? C.primary : '#C5CBD6', position:'relative',
                       transition:'background 0.2s' }}>
              <div style={{ position:'absolute', top:3, left: isPublic ? 21 : 3, width:20, height:20,
                             borderRadius:'50%', background:'#fff',
                             boxShadow:'0 1px 4px rgba(0,0,0,0.18)',
                             transition:'left 0.2s' }}/>
            </div>
          </div>
        )}
        {!canPublish && (
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10,
                        background:'#FFF6EC', borderRadius:10, padding:'9px 12px' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="#F59E0B" strokeWidth="2"/>
              <path d="M12 8v5M12 16h.01" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize:13, fontWeight:600, color:'#92400E' }}>
              Add an event title to publish
            </span>
          </div>
        )}
        {isEditing ? (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ display:'flex', gap:10 }}>
              <button
                onClick={handleCancelEvent}
                disabled={submitting}
                style={{
                  flex:'0 0 auto', height:50, padding:'0 20px', borderRadius:15,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  border:`1.5px solid #FFD3CC`, background:'#FFF1ED', color:C.danger,
                  fontSize:16, fontWeight:800,
                  fontFamily:"'Montserrat',-apple-system,sans-serif",
                  opacity: submitting ? 0.7 : 1,
                }}>
                {submittingStatus === 'cancel' ? 'Cancelling…' : 'Cancel Event'}
              </button>
              <button
                onClick={() => submitEvent(eventStatus)}
                disabled={!canPublish || submitting}
                style={{
                  flex:1, height:50, border:'none', borderRadius:15,
                  cursor: canPublish && !submitting ? 'pointer' : 'not-allowed',
                  background: canPublish ? 'linear-gradient(135deg,#19BFFF,#008FF0)' : '#C5CBD6',
                  color:'#fff', fontSize:16, fontWeight:800,
                  fontFamily:"'Montserrat',-apple-system,sans-serif",
                  opacity: submitting ? 0.7 : 1,
                }}>
                {submittingStatus === eventStatus ? 'Saving…' : eventStatus === 'draft' ? 'Save Draft' : 'Save Changes'}
              </button>
            </div>
            {/* A draft loaded here otherwise had no path to ever go live --
                "Save Changes" only ever wrote back the status it loaded
                with, so a draft stayed a draft forever. */}
            {eventStatus === 'draft' && (
              <button
                onClick={() => submitEvent('pending')}
                disabled={!canPublish || submitting}
                style={{
                  height:50, border:'none', borderRadius:15,
                  cursor: canPublish && !submitting ? 'pointer' : 'not-allowed',
                  background: canPublish ? 'linear-gradient(135deg,#19BFFF,#008FF0)' : '#C5CBD6',
                  color:'#fff', fontSize:16, fontWeight:800,
                  fontFamily:"'Montserrat',-apple-system,sans-serif",
                  display:'flex', alignItems:'center', justifyContent:'center', gap:9,
                  boxShadow: canPublish && !submitting ? '0 8px 20px rgba(2,162,240,0.4)' : 'none',
                  opacity: submitting ? 0.7 : 1,
                }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"
                        stroke="#fff" strokeWidth="1.9" strokeLinejoin="round"/>
                </svg>
                {submittingStatus === 'pending' ? 'Submitting…' : 'Submit for Approval'}
              </button>
            )}
          </div>
        ) : (
        <div style={{ display:'flex', gap:10 }}>
          <button
            disabled={!canPublish || submitting}
            onClick={() => submitEvent('draft')}
            style={{
              flex:'0 0 auto', height:50, padding:'0 20px', borderRadius:15,
              cursor: canPublish && !submitting ? 'pointer' : 'not-allowed',
              border:`1.5px solid ${C.border}`, background:C.card, color:C.body,
              fontSize:16, fontWeight:800,
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              opacity: submitting ? 0.7 : 1,
            }}>
            {submittingStatus === 'draft' ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            onClick={() => submitEvent('published')}
            style={{
              flex:1, height:50, border:'none', borderRadius:15,
              cursor: canPublish && !submitting ? 'pointer' : 'not-allowed',
              background: canPublish ? 'linear-gradient(135deg,#19BFFF,#008FF0)' : '#C5CBD6',
              color:'#fff', fontSize:16, fontWeight:800,
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              display:'flex', alignItems:'center', justifyContent:'center', gap:9,
              boxShadow: canPublish ? '0 8px 20px rgba(2,162,240,0.4)' : 'none',
              opacity: submitting ? 0.7 : 1,
            }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"
                    stroke="#fff" strokeWidth="1.9" strokeLinejoin="round"/>
            </svg>
            {submittingStatus === 'published' ? 'Publishing…' : 'Publish Event'}
            {canPublish && !submitting && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M5 12h13M13 6l6 6-6 6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// SCREEN: GROUP MANAGE
// ─────────────────────────────────────────────────────────────
function GroupManageScreen({ groupId, goBack, navigate, showToast, currentUser }) {
  const [dbGroup, setDbGroup] = useState(null);
  const [isAuthorized, setIsAuthorized] = useState(null);
  const authGenRef = useRef(0);
  useEffect(() => {
    if (!groupId) return;
    const gen = ++authGenRef.current;
    const isStale = () => gen !== authGenRef.current;

    setDbGroup(null);
    setIsAuthorized(null); // back to "checking" for the new group, not stale true/false
    supabase.from('groups').select('*').eq('id', groupId).maybeSingle()
      .then(({ data }) => { if (!isStale() && data) setDbGroup(data); });

    // Auth still resolving (Clerk/profile) — stay in the loading state rather
    // than treating a momentarily-null userId as "not authorized".
    if (!currentUser?.isLoaded || currentUser?.profileLoading) return;
    if (!currentUser?.userId) { setIsAuthorized(false); return; }
    supabase.from('group_members').select('role').eq('group_id', groupId).eq('user_id', currentUser.userId).maybeSingle()
      .then(({ data }) => { if (!isStale()) setIsAuthorized(data?.role === 'admin' || data?.role === 'owner'); });
  }, [groupId, currentUser?.userId, currentUser?.isLoaded, currentUser?.profileLoading]);
  const staticG = GROUPS.find(gr => gr.id === groupId) || GROUPS[0];
  const g = dbGroup || staticG;

  const [stats, setStats] = useState({ membersToday: 0, commentsWeek: 0, openReports: 0, pending: 0 });
  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    (async () => {
      const dayAgo = new Date(Date.now() - 86400000).toISOString();
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

      const [membersRes, postsRes, reportsRes, pendingRes] = await Promise.all([
        supabase.from('group_members').select('*', { count: 'exact', head: true })
          .eq('group_id', groupId).in('role', ['member', 'admin', 'owner']).gte('joined_at', dayAgo),
        supabase.from('posts').select('id').eq('group_id', groupId),
        supabase.from('post_reports').select('*', { count: 'exact', head: true })
          .eq('group_id', groupId).eq('status', 'open'),
        supabase.from('group_members').select('*', { count: 'exact', head: true })
          .eq('group_id', groupId).eq('role', 'pending'),
      ]);
      if (cancelled) return;

      let commentsWeek = 0;
      const postIds = (postsRes.data || []).map(p => p.id);
      if (postIds.length) {
        const { count } = await supabase.from('post_comments').select('*', { count: 'exact', head: true })
          .in('post_id', postIds).gte('created_at', weekAgo);
        commentsWeek = count || 0;
      }
      if (cancelled) return;
      setStats({
        membersToday: membersRes.count || 0,
        commentsWeek,
        openReports: reportsRes.count || 0,
        pending: pendingRes.count || 0,
      });
    })();
    return () => { cancelled = true; };
  }, [groupId]);

  if (isAuthorized === false) {
    return (
      <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center',
                    justifyContent:'center', gap:12, padding:24, textAlign:'center',
                    fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
        <div style={{ fontSize:18, fontWeight:800, color:C.ink }}>Admins only</div>
        <div style={{ fontSize:15, color:C.subtle }}>You need to be an admin of this group to manage it.</div>
        <button onClick={goBack} style={{ marginTop:8, height:44, padding:'0 22px', border:'none',
          borderRadius:999, background:C.ink, color:'#fff', fontWeight:700, cursor:'pointer' }}>Go back</button>
      </div>
    );
  }
  if (isAuthorized === null) {
    return <div style={{ height:'100%', background:C.pageBg }} />;
  }

  const SETTINGS = [
    { key:'info',    label:'Edit Group Info',    iconBg:'#E9F6FF', iconColor:C.primary,
      icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M5 19h3l9-9-3-3-9 9v3Z" stroke={C.primary} strokeWidth="1.9" strokeLinejoin="round"/><path d="m14.5 6.5 3 3" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round"/></svg>,
      onPress:()=>navigate('group-edit',{groupId, editTab:'info'}) },
    { key:'social',  label:'Social Media Links',  iconBg:'#F1ECFF', iconColor:'#7C5CFF',
      icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M9 15l6-6M8 12l-2 2a3 3 0 1 0 4 4l2-2M16 12l2-2a3 3 0 1 0-4-4l-2 2" stroke="#7C5CFF" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      onPress:()=>navigate('group-edit',{groupId, editTab:'social'}) },
    { key:'rules',   label:'Group Rules',          iconBg:'#FFF6EC', iconColor:'#F59E0B',
      icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M4 6h10M4 12h10M4 18h6" stroke="#F59E0B" strokeWidth="1.9" strokeLinecap="round"/><path d="m16 6 2 2 3-3M16 16l2 2 3-3" stroke="#F59E0B" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      onPress:()=>navigate('group-edit',{groupId, editTab:'rules'}) },
    { key:'privacy', label:'Privacy Settings',     iconBg:'#E4F7EC', iconColor:'#15A34A',
      icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 3.5 5 6v5.5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-2.5Z" stroke="#15A34A" strokeWidth="1.9" strokeLinejoin="round"/></svg>,
      onPress:()=>navigate('group-edit',{groupId, editTab:'privacy'}) },
  ];

  const ACTIVITY = [
    { title:`${stats.membersToday} new member${stats.membersToday===1?'':'s'} joined today`, time:'Last 24 hours', iconBg:'#E9F6FF',
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="9" r="2.6" stroke={C.primary} strokeWidth="1.8"/><circle cx="16" cy="9" r="2.6" stroke={C.primary} strokeWidth="1.8"/><path d="M3.5 18c0-2.4 2-3.8 4.5-3.8M20.5 18c0-2.4-2-3.8-4.5-3.8M9 18c0-2 1.4-3.2 3-3.2s3 1.2 3 3.2" stroke={C.primary} strokeWidth="1.8" strokeLinecap="round"/></svg> },
    { title:`${stats.commentsWeek} new comment${stats.commentsWeek===1?'':'s'} this week`, time:'Last 7 days', iconBg:'#E4F7EC',
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3.5V16.5H6a2 2 0 0 1-2-2Z" stroke="#15A34A" strokeWidth="1.8" strokeLinejoin="round"/></svg> },
    { title:`${stats.openReports} post${stats.openReports===1?'':'s'} reported for review`, time:'Open now', iconBg:'#FFF1ED',
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 3v18M6 4h11l-2 4 2 4H6" stroke="#F4452B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  ];

  const MODERATION = [
    { label:'Review Reports',    iconBg:'#FFF1ED', iconColor:'#F4452B', badge: stats.openReports > 0 ? String(stats.openReports) : null,
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#F4452B" strokeWidth="1.8"/><path d="M12 7.5v5M12 16h.01" stroke="#F4452B" strokeWidth="2" strokeLinecap="round"/></svg>,
      onPress:()=>navigate('review-reports',{groupId}) },
    { label:'Pending Requests',  iconBg:'#FFF6EC', iconColor:'#F59E0B', badge: stats.pending > 0 ? String(stats.pending) : null,
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="#F59E0B" strokeWidth="1.8"/><path d="M12 8v4.5l3 2" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      onPress:()=>navigate('pending-requests',{groupId}) },
    { label:'Banned Members',    iconBg:'#F1F3F7', iconColor:'#5B6473', badge:null,
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="#5B6473" strokeWidth="1.8"/><path d="m6 6 12 12" stroke="#5B6473" strokeWidth="1.8" strokeLinecap="round"/></svg>,
      onPress:()=>navigate('banned-members',{groupId}) },
    { label:'Message UMSU Support', iconBg:'#E9F6FF', iconColor:C.primary, badge:null,
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3.5V16.5H6a2 2 0 0 1-2-2Z" stroke={C.primary} strokeWidth="1.8" strokeLinejoin="round"/></svg>,
      onPress: async () => {
        try {
          const { data: chatId, error } = await supabase.rpc('create_admin_thread', { p_group_id: groupId });
          if (error || !chatId) { showToast('Failed to reach UMSU support'); return; }
          // isGroup: true -- this is a shared thread with every UMSU admin for
          // the campus, not a 1:1 DM, so incoming messages need per-sender
          // names/avatars rather than all showing "UMSU Support".
          navigate('chat', { chatId, chatName: 'UMSU Support', chatInitial: 'U', chatColor: 'linear-gradient(135deg,#19BFFF,#0098F0)', isGroup: true });
        } catch {
          showToast('Failed to reach UMSU support');
        }
      } },
  ];

  const Row = ({ icon, iconBg, label, chevron=true, badge, onPress, last=false }) => (
    <button onClick={onPress} style={{
      display:'flex', alignItems:'center', gap:13, width:'100%', border:'none',
      background:'none', padding:'14px 0', cursor:'pointer',
      fontFamily:"'Montserrat',-apple-system,sans-serif",
      borderBottom: last ? 'none' : `1px solid ${C.divider}`,
    }}>
      <div style={{ width:38, height:38, borderRadius:11, flexShrink:0,
                    background:iconBg, display:'flex', alignItems:'center',
                    justifyContent:'center' }}>{icon}</div>
      <span style={{ flex:1, textAlign:'left', fontSize:16.5, fontWeight:700,
                     color:C.ink }}>{label}</span>
      {badge && (
        <span style={{ minWidth:22, height:22, padding:'0 6px', borderRadius:999,
                       background:'#F4452B', color:'#fff', fontSize:13,
                       fontWeight:800, display:'flex', alignItems:'center',
                       justifyContent:'center', marginRight:6 }}>{badge}</span>
      )}
      {chevron && (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="m9 6 6 6-6 6" stroke="#C5CBD6" strokeWidth="2.2"
                strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      {/* Header */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)',
                    backdropFilter:'blur(16px)', padding:'52px 14px 12px',
                    display:'flex', alignItems:'center', gap:8,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', zIndex:4 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none',
          borderRadius:13, background:C.chip, display:'flex', alignItems:'center',
          justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Group Settings</div>
        <div style={{ width:40 }}/>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'16px 16px 30px' }}>

        {/* Analytics banner */}
        <button onClick={() => navigate('group-analytics', {groupId})} style={{
          width:'100%', display:'flex', alignItems:'center', gap:13,
          background:'linear-gradient(135deg,#19BFFF,#0E84E0)', border:'none',
          borderRadius:18, padding:16, marginTop:12, cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          boxShadow:'0 8px 20px rgba(2,162,240,0.32)',
        }}>
          <div style={{ width:42, height:42, borderRadius:13, flexShrink:0,
                        background:'rgba(255,255,255,0.22)', display:'flex',
                        alignItems:'center', justifyContent:'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M4 19V5M4 19h16M8 15v-3M12 15V9M16 15v-6"
                    stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ flex:1, textAlign:'left' }}>
            <div style={{ fontSize:17, fontWeight:800, color:'#fff' }}>Group Analytics</div>
            <div style={{ fontSize:14, color:'rgba(255,255,255,0.85)', marginTop:1 }}>
              Engagement, revenue &amp; top contributors
            </div>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="m9 6 6 6-6 6" stroke="rgba(255,255,255,0.9)" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Group Settings rows */}
        <div style={{ fontSize:18, fontWeight:800, color:C.ink, margin:'22px 4px 11px' }}>
          Group Settings
        </div>
        <div style={{ background:'#fff', borderRadius:18,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)', padding:'0 14px' }}>
          {SETTINGS.map((s, i) => (
            <Row key={s.key} icon={s.icon} iconBg={s.iconBg}
              label={s.label} onPress={s.onPress} last={i===SETTINGS.length-1}/>
          ))}
        </div>

        {/* Activity feed */}
        <div style={{ fontSize:18, fontWeight:800, color:C.ink, margin:'22px 4px 11px' }}>
          Recent Activity
        </div>
        <div style={{ background:'#fff', borderRadius:18,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)', padding:'0 14px' }}>
          {ACTIVITY.map((a, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:12,
                                   padding:'14px 0',
                                   borderBottom: i<ACTIVITY.length-1 ? `1px solid ${C.divider}` : 'none' }}>
              <div style={{ width:36, height:36, borderRadius:10, flexShrink:0,
                            background:a.iconBg, display:'flex', alignItems:'center',
                            justifyContent:'center' }}>{a.icon}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:15.5, fontWeight:700, color:C.ink }}>{a.title}</div>
                <div style={{ fontSize:13.5, color:C.subtle, marginTop:2 }}>{a.time}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Moderation */}
        <div style={{ fontSize:18, fontWeight:800, color:C.ink, margin:'22px 4px 11px' }}>
          Moderation
        </div>
        <div style={{ background:'#fff', borderRadius:18,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)', padding:'0 14px' }}>
          {MODERATION.map((m, i) => (
            <Row key={m.label} icon={m.icon} iconBg={m.iconBg}
              label={m.label} badge={m.badge} onPress={m.onPress}
              last={i===MODERATION.length-1}/>
          ))}
        </div>

        {/* Archive */}
        <button onClick={async () => {
          const confirmed = window.confirm('Archive this group? Members will no longer be able to post or join. This cannot be undone.');
          if (!confirmed) return;
          const { error } = await supabase.from('groups').update({ archived: true }).eq('id', groupId);
          if (error) { showToast('Failed to archive: ' + error.message); return; }
          showToast('Group archived');
          goBack();
        }} style={{
          width:'100%', height:50, marginTop:18, border:`1.5px solid #FAD9D4`,
          borderRadius:15, background:'#fff', color:C.danger,
          fontSize:16.5, fontWeight:800, cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          display:'flex', alignItems:'center', justifyContent:'center', gap:8,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M5 7h14M9 7V5h6v2M6 7l1 13h10l1-13"
                  stroke={C.danger} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Archive Group
        </button>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// SCREEN: REVIEW REPORTS
// ─────────────────────────────────────────────────────────────
function ReviewReportsScreen({ groupId, goBack, showToast }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from('post_reports')
        .select('id, post_id, reporter_id, reason, created_at, posts(text, content, author_name)')
        .eq('group_id', groupId).eq('status', 'open')
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) { console.error('[review-reports] load failed:', error); setReports([]); setLoading(false); return; }

      const rows = data || [];
      const reporterIds = [...new Set(rows.map(r => r.reporter_id).filter(Boolean))];
      let reporterNames = {};
      if (reporterIds.length) {
        const { data: reporters } = await supabase.from('users').select('id, name').in('id', reporterIds);
        (reporters || []).forEach(u => { reporterNames[u.id] = u.name; });
      }
      if (cancelled) return;
      setReports(rows.map(r => ({
        id: r.id,
        postId: r.post_id,
        reporter: reporterNames[r.reporter_id] || 'A member',
        reportee: r.posts?.author_name || 'Unknown',
        reason: r.reason || 'Reported content',
        content: r.posts?.text || r.posts?.content || '(post no longer available)',
        time: relTime(r.created_at),
      })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [groupId]);

  const open = reports.filter(r => !dismissed[r.id]);

  const resolve = async (r, action) => {
    setDismissed(s => ({ ...s, [r.id]: true }));
    if (action === 'remove' && r.postId) {
      const { error: deleteError } = await supabase.from('posts').delete().eq('id', r.postId);
      if (deleteError) {
        setDismissed(s => { const n = { ...s }; delete n[r.id]; return n; });
        showToast('Failed to remove content: ' + deleteError.message);
        return;
      }
    }
    const { error } = await supabase.from('post_reports')
      .update({ status: action === 'remove' ? 'removed' : 'dismissed' }).eq('id', r.id);
    if (error) {
      setDismissed(s => { const n = { ...s }; delete n[r.id]; return n; });
      showToast('Failed to update report: ' + error.message);
      return;
    }
    showToast(action === 'remove' ? 'Content removed' : 'Report dismissed');
  };

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)', backdropFilter:'blur(16px)',
                    padding:'52px 14px 12px', display:'flex', alignItems:'center', gap:8,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', zIndex:4 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none', borderRadius:13,
          background:C.chip, display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Review Reports</div>
        <div style={{ width:40 }}/>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'14px 16px 30px',
                    display:'flex', flexDirection:'column', gap:12 }}>
        {loading ? (
          <SkeletonRows />
        ) : open.length === 0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                        textAlign:'center', padding:'60px 30px' }}>
            <div style={{ width:78, height:78, borderRadius:24, background:'#E4F7EC',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
                <path d="m5 12.5 4 4L19 7" stroke="#15A34A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{ fontSize:19, fontWeight:800, color:C.ink, marginTop:18 }}>No open reports</div>
            <div style={{ fontSize:15, color:C.subtle, marginTop:6, maxWidth:230 }}>All reports have been reviewed.</div>
          </div>
        ) : open.map(r => (
          <div key={r.id} style={{ background:'#fff', borderRadius:18,
                                    boxShadow:'0 4px 14px rgba(16,24,40,0.05)', padding:15 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
              <div style={{ width:38, height:38, borderRadius:11, flexShrink:0,
                            background:'#FFF1ED', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="#F4452B" strokeWidth="1.8"/>
                  <path d="M12 7.5v5M12 16h.01" stroke="#F4452B" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:15, fontWeight:800, color:C.ink }}>{r.reason}</div>
                <div style={{ fontSize:13.5, color:C.subtle, marginTop:1 }}>
                  Reported by {r.reporter} · {r.time}
                </div>
              </div>
              <span style={{ fontSize:12.5, fontWeight:700, padding:'3px 9px', borderRadius:999,
                             background:'#FFF1ED', color:'#F4452B' }}>post</span>
            </div>
            <div style={{ background:'#F7F8FB', borderRadius:12, padding:'10px 13px',
                          fontSize:15, color:C.muted, lineHeight:1.45, marginBottom:12 }}>
              <span style={{ fontWeight:700, color:C.ink }}>{r.reportee}: </span>{r.content}
            </div>
            <div style={{ display:'flex', gap:9 }}>
              <button onClick={() => resolve(r, 'remove')} style={{
                flex:1, height:40, border:'none', borderRadius:12,
                background:'linear-gradient(135deg,#FF3B6B,#F4452B)',
                color:'#fff', fontSize:14.5, fontWeight:800, cursor:'pointer',
                fontFamily:"'Montserrat',-apple-system,sans-serif",
              }}>Remove content</button>
              <button onClick={() => resolve(r, 'dismiss')} style={{
                flex:1, height:40, border:`1.5px solid ${C.border}`, borderRadius:12,
                background:'#fff', color:C.muted, fontSize:14.5, fontWeight:800, cursor:'pointer',
                fontFamily:"'Montserrat',-apple-system,sans-serif",
              }}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// SCREEN: PENDING REQUESTS
// ─────────────────────────────────────────────────────────────
function PendingRequestsScreen({ groupId, goBack, showToast }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from('group_members')
        .select('user_id, joined_at, users(name, avatar_url, avatar_color, university, program, year)')
        .eq('group_id', groupId).eq('role', 'pending')
        .order('joined_at', { ascending: false });
      if (cancelled) return;
      if (error) { console.error('[pending-requests] load failed:', error); setRequests([]); setLoading(false); return; }
      setRequests((data || []).map(r => ({
        userId: r.user_id,
        name: r.users?.name || 'Member',
        avatarUrl: r.users?.avatar_url || null,
        color: r.users?.avatar_color || 'linear-gradient(135deg,#7C5CFF,#B06BFF)',
        meta: [r.users?.year, r.users?.program].filter(Boolean).join(' · '),
        time: relTime(r.joined_at),
      })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [groupId]);

  const open = requests.filter(r => !done[r.userId]);

  // notify_membership_decision now performs the accept/decline mutation
  // itself (atomically with the notification) so the two can never diverge
  // -- see the SQL function's comment for why that matters.
  const resolve = async (r, accept) => {
    setDone(s => ({ ...s, [r.userId]: true }));
    const { error } = await supabase.rpc('notify_membership_decision', {
      p_group_id: groupId, p_target_user_id: r.userId, p_accepted: accept,
    });
    if (error) {
      setDone(s => { const n = { ...s }; delete n[r.userId]; return n; });
      showToast(`Failed to ${accept ? 'accept' : 'decline'}: ` + error.message);
      return;
    }
    showToast(accept ? `${r.name} accepted` : `${r.name} declined`);
  };
  const acceptAll = async () => {
    const targets = open;
    setDone(s => { const n = { ...s }; targets.forEach(r => { n[r.userId] = true; }); return n; });
    const results = await Promise.all(targets.map(r =>
      supabase.rpc('notify_membership_decision', { p_group_id: groupId, p_target_user_id: r.userId, p_accepted: true })
    ));
    const failed = results.filter(({ error }) => error);
    if (failed.length > 0) {
      console.error('[pending-requests] accept-all had failures:', failed.map(f => f.error));
      setDone(s => {
        const n = { ...s };
        targets.forEach((r, i) => { if (results[i].error) delete n[r.userId]; });
        return n;
      });
      showToast(failed.length === targets.length ? 'Failed to accept all' : `Accepted ${targets.length - failed.length} of ${targets.length}`);
      return;
    }
    showToast('All requests accepted');
  };

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      {/* Header */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)',
                    backdropFilter:'blur(16px)', padding:'52px 14px 12px',
                    display:'flex', alignItems:'center', gap:8,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', zIndex:4 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none',
          borderRadius:13, background:C.chip, display:'flex', alignItems:'center',
          justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Pending Requests</div>
        <div style={{ width:40 }}/>
      </div>

      {/* Bulk bar */}
      {open.length > 0 && (
        <div style={{ flexShrink:0, padding:'13px 16px 0',
                      display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:15, fontWeight:700, color:C.muted }}>
            {open.length} waiting to join
          </span>
          <button onClick={acceptAll} style={{
            height:34, padding:'0 14px', border:'none', borderRadius:11,
            background:'#E4F7EC', color:'#15A34A', fontSize:14.5, fontWeight:800,
            cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
          }}>Accept all</button>
        </div>
      )}

      {/* List */}
      <div style={{ flex:1, overflowY:'auto', padding:'13px 16px 30px',
                    display:'flex', flexDirection:'column', gap:12 }}>

        {loading && <SkeletonRows />}

        {!loading && open.length === 0 && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                        textAlign:'center', padding:'60px 30px' }}>
            <div style={{ width:78, height:78, borderRadius:24, background:'#E4F7EC',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
                <path d="m5 12.5 4 4L19 7" stroke="#15A34A" strokeWidth="2.4"
                      strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{ fontSize:19, fontWeight:800, color:C.ink, marginTop:18 }}>
              No pending requests
            </div>
            <div style={{ fontSize:15, color:C.subtle, marginTop:6, maxWidth:230 }}>
              You're all caught up. New join requests will appear here.
            </div>
          </div>
        )}

        {open.map(r => (
          <div key={r.userId} style={{ background:'#fff', borderRadius:18,
                                    boxShadow:'0 4px 14px rgba(16,24,40,0.05)', padding:14 }}>
            {/* Avatar + name */}
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ width:46, height:46, borderRadius:'50%', flexShrink:0,
                            background: r.avatarUrl ? 'transparent' : r.color, display:'flex', alignItems:'center',
                            justifyContent:'center', fontSize:17, fontWeight:800,
                            color:'#fff', position:'relative', overflow:'hidden' }}>
                {r.avatarUrl
                  ? <img src={r.avatarUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                  : <>
                      <span>{r.name[0]?.toUpperCase()}</span>
                      <div style={{ position:'absolute', inset:0, background:
                        'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 9px)'}}/>
                    </>}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:16.5, fontWeight:800, color:C.ink }}>{r.name}</div>
                <div style={{ fontSize:13.5, color:C.subtle, marginTop:1 }}>{r.meta}</div>
              </div>
              <span style={{ fontSize:13, color:'#B6BCC8', flexShrink:0 }}>{r.time}</span>
            </div>

            {/* Actions */}
            <div style={{ display:'flex', gap:9, marginTop:12 }}>
              <button onClick={() => resolve(r, true)} style={{
                flex:1, height:42, border:'none', borderRadius:12,
                background:'linear-gradient(135deg,#19BFFF,#008FF0)',
                color:'#fff', fontSize:15, fontWeight:800, cursor:'pointer',
                fontFamily:"'Montserrat',-apple-system,sans-serif",
                display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                boxShadow:'0 4px 12px rgba(2,162,240,0.28)',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="m5 12.5 4 4L19 7" stroke="#fff" strokeWidth="2.4"
                        strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Accept
              </button>
              <button onClick={() => resolve(r, false)} style={{
                flex:1, height:42, border:`1.5px solid ${C.border}`, borderRadius:12,
                background:'#fff', color:C.muted, fontSize:15, fontWeight:800,
                cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
              }}>
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// SCREEN: BANNED MEMBERS
// ─────────────────────────────────────────────────────────────
function relTime(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso);
  const days = Math.floor(diffMs / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
}

function BannedMembersScreen({ groupId, goBack, showToast }) {
  const [banned, setBanned] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from('group_members')
        .select('user_id, ban_reason, banned_by, banned_at, users(name, avatar_url, avatar_color)')
        .eq('group_id', groupId).eq('status', 'banned')
        .order('banned_at', { ascending: false });
      if (cancelled) return;
      if (error) { console.error('[banned-members] load failed:', error); setBanned([]); setLoading(false); return; }

      const rows = data || [];
      const bannerIds = [...new Set(rows.map(r => r.banned_by).filter(Boolean))];
      let bannerNames = {};
      if (bannerIds.length) {
        const { data: banners } = await supabase.from('users').select('id, name').in('id', bannerIds);
        (banners || []).forEach(u => { bannerNames[u.id] = u.name; });
      }
      if (cancelled) return;
      setBanned(rows.map(r => ({
        userId: r.user_id,
        name: r.users?.name || 'Member',
        avatarUrl: r.users?.avatar_url || null,
        color: r.users?.avatar_color || 'linear-gradient(135deg,#F59E0B,#EF4444)',
        reason: r.ban_reason || 'No reason given',
        when: relTime(r.banned_at),
        by: bannerNames[r.banned_by] || 'an admin',
      })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [groupId]);

  const visible = banned;

  const unban = async (m) => {
    const { error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', m.userId);
    if (error) { showToast('Failed to unban: ' + error.message); return; }
    setBanned(prev => prev.filter(x => x.userId !== m.userId));
    showToast(`${m.name} has been unbanned`);
  };

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      {/* Header */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)',
                    backdropFilter:'blur(16px)', padding:'52px 14px 12px',
                    display:'flex', alignItems:'center', gap:8,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', zIndex:4 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none',
          borderRadius:13, background:C.chip, display:'flex', alignItems:'center',
          justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Banned Members</div>
        <div style={{ width:40 }}/>
      </div>

      {/* Body */}
      <div style={{ flex:1, overflowY:'auto', padding:'16px 16px 30px' }}>

        {loading && <SkeletonRows />}

        {!loading && visible.length > 0 && (
          <div style={{ fontSize:14.5, color:C.muted, lineHeight:1.55, marginBottom:14 }}>
            Banned members can't view, post, or join this group. You can lift a ban at any time.
          </div>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

          {!loading && visible.length === 0 && (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                          textAlign:'center', padding:'60px 30px' }}>
              <div style={{ width:78, height:78, borderRadius:24, background:'#E4F7EC',
                            display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="8" r="3.4" stroke="#15A34A" strokeWidth="1.8"/>
                  <path d="M5 20c0-3.6 3-5.6 7-5.6s7 2 7 5.6"
                        stroke="#15A34A" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </div>
              <div style={{ fontSize:19, fontWeight:800, color:C.ink, marginTop:18 }}>
                No banned members
              </div>
              <div style={{ fontSize:15, color:C.subtle, marginTop:6, maxWidth:230 }}>
                Everyone's in good standing. Members you ban will appear here.
              </div>
            </div>
          )}

          {visible.map(m => (
            <div key={m.userId} style={{ background:'#fff', borderRadius:18,
                                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)',
                                      padding:14 }}>
              {/* Avatar + name + unban */}
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:44, height:44, borderRadius:'50%', flexShrink:0,
                              background: m.avatarUrl ? 'transparent' : m.color, display:'flex', alignItems:'center',
                              justifyContent:'center', fontSize:16, fontWeight:800,
                              color:'#fff', position:'relative', overflow:'hidden' }}>
                  {m.avatarUrl
                    ? <img src={m.avatarUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                    : <>
                        <span>{m.name[0]?.toUpperCase()}</span>
                        <div style={{ position:'absolute', inset:0, background:
                          'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 9px)'}}/>
                      </>}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:16.5, fontWeight:800, color:C.ink }}>{m.name}</div>
                  <div style={{ fontSize:13.5, color:C.subtle, marginTop:1 }}>
                    Banned {m.when} · by {m.by}
                  </div>
                </div>
                <button onClick={() => unban(m)} style={{
                  flexShrink:0, height:36, padding:'0 15px',
                  border:`1.5px solid #BEE3FF`, borderRadius:11,
                  background:'#fff', color:C.primary,
                  fontSize:14.5, fontWeight:800, cursor:'pointer',
                  fontFamily:"'Montserrat',-apple-system,sans-serif",
                }}>
                  Unban
                </button>
              </div>

              {/* Ban reason card */}
              <div style={{ display:'flex', gap:8, marginTop:12, padding:'10px 12px',
                            borderRadius:12, background:'#FFF6F4',
                            border:'1px solid #FBE0DA' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                  style={{ flexShrink:0, marginTop:1 }}>
                  <circle cx="12" cy="12" r="9" stroke="#F4452B" strokeWidth="1.8"/>
                  <path d="M12 7.5v5M12 16h.01" stroke="#F4452B" strokeWidth="2"
                        strokeLinecap="round"/>
                </svg>
                <div style={{ fontSize:13.5, color:'#B43425', lineHeight:1.45 }}>
                  {m.reason}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// SCREEN: GROUP ANALYTICS
// ─────────────────────────────────────────────────────────────
function GroupAnalyticsScreen({ groupId, goBack, showToast, currentUser }) {
  const PERIODS = ['7 Days', '30 Days', '90 Days'];

  const [periodIdx, setPeriodIdx] = useState(0);
  const [stats, setStats] = useState(null);
  const [contributors, setContributors] = useState([]);
  const [barData, setBarData] = useState({ bars: [0,0,0,0,0,0,0], labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] });
  const [isAuthorized, setIsAuthorized] = useState(null);
  const authGenRef = useRef(0);

  useEffect(() => {
    if (!groupId) return;
    const gen = ++authGenRef.current;
    const isStale = () => gen !== authGenRef.current;

    setIsAuthorized(null); // back to "checking" for the new group
    // Auth still resolving — stay in the loading state instead of treating a
    // momentarily-null userId as "not authorized".
    if (!currentUser?.isLoaded || currentUser?.profileLoading) return;
    if (!currentUser?.userId) { setIsAuthorized(false); return; }
    supabase.from('group_members').select('role').eq('group_id', groupId).eq('user_id', currentUser.userId).maybeSingle()
      .then(({ data }) => { if (!isStale()) setIsAuthorized(data?.role === 'admin' || data?.role === 'owner'); });
  }, [groupId, currentUser?.userId, currentUser?.isLoaded, currentUser?.profileLoading]);

  useEffect(() => {
    if (!groupId || isAuthorized !== true) return;

    // Real stats
    Promise.all([
      supabase.from('group_members').select('*', { count:'exact', head:true }).eq('group_id', groupId).in('role', ['member', 'admin', 'owner']),
      supabase.from('posts').select('likes_count, comment_count, created_at').eq('group_id', groupId),
      supabase.from('events').select('*', { count:'exact', head:true }).eq('group_id', groupId),
    ]).then(([members, posts, events]) => {
      const ps = posts.data || [];
      const totalLikes = ps.reduce((s, p) => s + (p.likes_count || 0), 0);
      const totalComments = ps.reduce((s, p) => s + (p.comment_count || 0), 0);
      const now = new Date();
      const weekAgo = new Date(now - 7 * 86400000);
      const newPosts = ps.filter(p => new Date(p.created_at) > weekAgo).length;
      setStats({
        members: members.count ?? 0,
        posts: ps.length,
        events: events.count ?? 0,
        totalLikes,
        totalComments,
        newPosts,
      });

      // Bar chart: posts per weekday for last 7 days
      const dayBuckets = [0,0,0,0,0,0,0];
      ps.filter(p => new Date(p.created_at) > weekAgo).forEach(p => {
        const day = new Date(p.created_at).getDay(); // 0=Sun
        dayBuckets[day === 0 ? 6 : day - 1]++;
      });
      setBarData({ bars: dayBuckets, labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] });
    });

    // Top contributors
    supabase.from('posts').select('user_id, author_name, author_initial, author_color, likes_count')
      .eq('group_id', groupId).then(({ data }) => {
        if (!data?.length) return;
        const byUser = {};
        data.forEach(p => {
          const uid = p.user_id || 'unknown';
          if (!byUser[uid]) byUser[uid] = { name: p.author_name || 'Member', initial: p.author_initial || '?', color: p.author_color || C.grad, posts: 0, likes: 0 };
          byUser[uid].posts++;
          byUser[uid].likes += (p.likes_count || 0);
        });
        const sorted = Object.values(byUser).sort((a,b) => b.posts - a.posts).slice(0, 3);
        setContributors(sorted);
      });
  }, [groupId, periodIdx, isAuthorized]);

  if (isAuthorized === false) {
    return (
      <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center',
                    justifyContent:'center', gap:12, padding:24, textAlign:'center',
                    fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
        <div style={{ fontSize:18, fontWeight:800, color:C.ink }}>Admins only</div>
        <div style={{ fontSize:15, color:C.subtle }}>You need to be an admin of this group to view its analytics.</div>
        <button onClick={goBack} style={{ marginTop:8, height:44, padding:'0 22px', border:'none',
          borderRadius:999, background:C.ink, color:'#fff', fontWeight:700, cursor:'pointer' }}>Go back</button>
      </div>
    );
  }
  if (isAuthorized === null) {
    return <div style={{ height:'100%', background:C.pageBg }} />;
  }

  const d   = barData;
  const max = Math.max(...d.bars, 1);

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      {/* Header */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)',
                    backdropFilter:'blur(16px)', padding:'52px 14px 12px',
                    display:'flex', alignItems:'center', gap:8,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', zIndex:4 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none',
          borderRadius:13, background:C.chip, display:'flex', alignItems:'center',
          justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Group Analytics</div>
        <div style={{ width:40 }}/>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'16px 16px 30px' }}>

        {/* Engagement Overview */}
        <div style={{ background:'#fff', borderRadius:20,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:18 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                        marginBottom:18 }}>
            <span style={{ fontSize:18, fontWeight:800, color:C.ink }}>Engagement Overview</span>
            {/* Period picker */}
            <div style={{ display:'flex', gap:5 }}>
              {PERIODS.map((p, i) => (
                <button key={p} onClick={() => setPeriodIdx(i)} style={{
                  height:30, padding:'0 10px', border:'none', borderRadius:9,
                  fontSize:13.5, fontWeight:700, cursor:'pointer',
                  fontFamily:"'Montserrat',-apple-system,sans-serif",
                  background: i===periodIdx ? C.primary : C.chip,
                  color: i===periodIdx ? '#fff' : C.muted,
                }}>{p}</button>
              ))}
            </div>
          </div>

          {/* Bar chart */}
          <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between',
                        gap:6, height:128, padding:'0 2px' }}>
            {d.bars.map((v, i) => (
              <div key={i} style={{ flex:1, display:'flex', flexDirection:'column',
                                     alignItems:'center', gap:7 }}>
                <div style={{ width:'100%', display:'flex', justifyContent:'center',
                              alignItems:'flex-end', height:96 }}>
                  <div style={{
                    width:7, borderRadius:999,
                    height: Math.round((v / max) * 96),
                    background: v === max
                      ? 'linear-gradient(180deg,#19BFFF,#0098F0)'
                      : '#E4E8EF',
                    transition:'height .3s ease',
                  }}/>
                </div>
                <span style={{ fontSize:12, fontWeight:600, color:C.subtle }}>
                  {d.labels[i]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* KPI Grid */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:14 }}>
          {[
            { value: stats ? (stats.members || '—') : '—', label:'Members',     iconBg:'#E9F6FF',
              icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke={C.primary} strokeWidth="2"/><path d="M5 20c0-3.6 3-5.6 7-5.6s7 2 7 5.6" stroke={C.primary} strokeWidth="2" strokeLinecap="round"/></svg> },
            { value: stats ? (stats.posts || '—') : '—',   label:'Total Posts', iconBg:'#F1ECFF',
              icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="3.5" width="16" height="17" rx="3" stroke="#7C5CFF" strokeWidth="2"/><path d="M8 9h8M8 13h8M8 17h5" stroke="#7C5CFF" strokeWidth="2" strokeLinecap="round"/></svg> },
            { value: stats ? (stats.totalLikes || '—') : '—', label:'Total Likes', iconBg:'#FFF0F4',
              icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 20S4 15 4 9.5A3.8 3.8 0 0 1 12 7a3.8 3.8 0 0 1 8 2.5C20 15 12 20 12 20Z" stroke="#FF5A8A" strokeWidth="2" strokeLinejoin="round"/></svg> },
            { value: stats ? (stats.totalComments || '—') : '—', label:'Comments', iconBg:'#E9F6FF',
              icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3.5V16.5H6a2 2 0 0 1-2-2Z" stroke="#19BFFF" strokeWidth="2" strokeLinejoin="round"/></svg> },
            { value: stats ? (stats.newPosts || '—') : '—', label:'Posts This Week', iconBg:'#E4F7EC',
              icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="3.5" width="16" height="17" rx="3" stroke="#10B981" strokeWidth="2"/><path d="M12 9v6M9 12h6" stroke="#10B981" strokeWidth="2" strokeLinecap="round"/></svg> },
            { value: stats ? (stats.events || '—') : '—', label:'Events', iconBg:'#FFF6EC',
              icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="17" rx="3" stroke="#F59E0B" strokeWidth="2"/><path d="M16 2v4M8 2v4M3 10h18" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/><circle cx="8" cy="14" r="1.3" fill="#F59E0B"/><circle cx="12" cy="14" r="1.3" fill="#F59E0B"/><circle cx="16" cy="14" r="1.3" fill="#F59E0B"/><circle cx="8" cy="18" r="1.3" fill="#F59E0B"/><circle cx="12" cy="18" r="1.3" fill="#F59E0B"/><circle cx="16" cy="18" r="1.3" fill="#F59E0B"/></svg> },
          ].map(k => (
            <div key={k.label} style={{ background:'#fff', borderRadius:18,
                                         boxShadow:'0 4px 14px rgba(16,24,40,0.05)',
                                         padding:'18px 16px', display:'flex',
                                         flexDirection:'column', alignItems:'center',
                                         textAlign:'center' }}>
              <div style={{ width:46, height:46, borderRadius:'50%', flexShrink:0,
                            background:k.iconBg, display:'flex', alignItems:'center',
                            justifyContent:'center' }}>{k.icon}</div>
              <div style={{ fontSize:26, fontWeight:800, letterSpacing:-0.8,
                            color:C.ink, marginTop:12 }}>{k.value}</div>
              <div style={{ fontSize:14, fontWeight:600, color:C.subtle,
                            marginTop:2 }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Top Contributors */}
        <div style={{ background:'#fff', borderRadius:20,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)',
                      padding:18, marginTop:14 }}>
          <div style={{ fontSize:18, fontWeight:800, color:C.ink, marginBottom:16 }}>
            Top Contributors
          </div>
          {contributors.length === 0
            ? <div style={{ textAlign:'center', padding:'20px 0', color:C.subtle, fontSize:15 }}>No posts yet</div>
            : <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {contributors.map((c, i) => {
                const badges = ['MVP','Star','Rising'];
                const badgeBgs = ['#FFCF4D','#E4E8EF','#FAD9C2'];
                const badgeColors = ['#7A5B00','#5B6473','#B45309'];
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ width:40, height:40, borderRadius:'50%', flexShrink:0,
                                  background:c.color, display:'flex', alignItems:'center',
                                  justifyContent:'center', color:'#fff', fontSize:15,
                                  fontWeight:800, position:'relative', overflow:'hidden' }}>
                      <span style={{ position:'relative', zIndex:1 }}>{c.initial}</span>
                      <div style={{ position:'absolute', inset:0, background:
                        'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 9px)'}}/>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:16, fontWeight:700, color:C.ink }}>{c.name}</div>
                      <div style={{ fontSize:13.5, color:C.subtle, marginTop:1 }}>
                        {c.posts} post{c.posts !== 1 ? 's' : ''} · {c.likes} like{c.likes !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <span style={{ flexShrink:0, height:26, padding:'0 10px', borderRadius:999,
                                   fontSize:13, fontWeight:800, display:'flex',
                                   alignItems:'center', justifyContent:'center',
                                   background:badgeBgs[i], color:badgeColors[i] }}>{badges[i]}</span>
                  </div>
                );
              })}
            </div>
          }
        </div>

      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// SCREEN: GROUP EDIT
// ─────────────────────────────────────────────────────────────
function GroupEditScreen({ groupId, editTab, goBack, showToast, currentUser }) {
  const staticG = GROUPS.find(gr => gr.id === groupId) || GROUPS[0];
  const [dbGroup, setDbGroup] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [coverUrl, setCoverUrl] = useState(null);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [uploadingCoverEdit, setUploadingCoverEdit] = useState(false);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [analytics, setAnalytics] = useState({ memberCount:0, postCount:0, newMembersWeek:0, topMembers:[] });

  // Admin-only gate, independent of GroupManageScreen's own check (this
  // screen is reachable directly, e.g. by navigating back to it, so it
  // can't just trust that the caller already verified admin status).
  const [isAuthorized, setIsAuthorized] = useState(null);
  const authGenRef = useRef(0);
  useEffect(() => {
    if (!groupId) return;
    const gen = ++authGenRef.current;
    const isStale = () => gen !== authGenRef.current;
    setIsAuthorized(null);
    if (!currentUser?.isLoaded || currentUser?.profileLoading) return;
    if (!currentUser?.userId) { setIsAuthorized(false); return; }
    supabase.from('group_members').select('role').eq('group_id', groupId).eq('user_id', currentUser.userId).maybeSingle()
      .then(({ data, error }) => {
        if (isStale()) return;
        setIsAuthorized(!error && (data?.role === 'admin' || data?.role === 'owner'));
      })
      // A query-level failure resolves with `error` set (handled above); this
      // catches a network-level failure (fetch itself throwing), which would
      // otherwise leave isAuthorized stuck at null and the screen loading
      // forever -- fail closed here too instead.
      .catch(() => { if (!isStale()) setIsAuthorized(false); });
  }, [groupId, currentUser?.userId, currentUser?.isLoaded, currentUser?.profileLoading]);

  useEffect(() => {
    if (!groupId) return;
    supabase.from('groups').select('*').eq('id', groupId).maybeSingle()
      .then(({ data }) => { if (data) { setDbGroup(data); setAvatarUrl(data.avatar_url || null); setCoverUrl(data.cover_url || null); } });
  }, [groupId]);

  // Load members when tab is active
  const loadMembers = async () => {
    setMembersLoading(true);
    const { data } = await supabase
      .from('group_members')
      .select('user_id, role, joined_at, users(id,name,avatar_url,avatar_color)')
      .eq('group_id', groupId)
      .order('joined_at', { ascending: false });
    setMembers(data || []);
    setMembersLoading(false);
  };

  // Load analytics
  const loadAnalytics = async () => {
    const weekAgo = new Date(Date.now() - 7*24*3600000).toISOString();
    const [{ count: memberCount }, { count: postCount }, { count: newMembersWeek }] = await Promise.all([
      supabase.from('group_members').select('*', { count:'exact', head:true }).eq('group_id', groupId),
      supabase.from('posts').select('*', { count:'exact', head:true }).eq('group_id', groupId),
      supabase.from('group_members').select('*', { count:'exact', head:true }).eq('group_id', groupId).gte('joined_at', weekAgo),
    ]);
    // Top members by join date (first 3)
    const { data: top } = await supabase
      .from('group_members')
      .select('user_id, role, users(name,avatar_url,avatar_color)')
      .eq('group_id', groupId)
      .order('joined_at', { ascending: true })
      .limit(3);
    setAnalytics({ memberCount: memberCount || 0, postCount: postCount || 0, newMembersWeek: newMembersWeek || 0, topMembers: top || [] });
  };

  const g = dbGroup || staticG;
  const TABS = ['Info','Privacy','Rules','Social','Members','Analytics'];
  const tabId = (t) => t.toLowerCase();

  const [tab,        setTab]        = useState(editTab || 'info');
  // Gated on isAuthorized === true, not just tab: entering the screen
  // directly on the members/analytics tab (editTab) would otherwise fire
  // these fetches before -- or even after failing -- the admin check.
  useEffect(() => { if (tab === 'members' && isAuthorized === true) loadMembers(); }, [tab, isAuthorized]);
  useEffect(() => { if (tab === 'analytics' && isAuthorized === true) loadAnalytics(); }, [tab, isAuthorized]);
  const [name,       setName]       = useState(staticG.name);
  const [desc,       setDesc]       = useState(staticG.desc || staticG.description || '');
  const [category,   setCategory]   = useState((staticG.cat || staticG.category || [])?.[0] || 'academic');
  const [visibility, setVisibility] = useState(staticG.privacy || 'public');
  const [perms,      setPerms]      = useState({ membersPost:true, requireApproval:false, allowInvites:true });
  const [rules,      setRules]      = useState(staticG.rules?.length ? [...staticG.rules] : ['Be respectful and constructive','Original work only — credit sources','No spam or self-promotion','Keep feedback kind and specific']);
  const [ruleDraft,  setRuleDraft]  = useState('');
  const [social,     setSocial]     = useState({ instagram:'', tiktok:'', website:'', discord:'' });
  const [saving,     setSaving]     = useState(false);
  // Populate from DB once loaded
  useEffect(() => {
    if (!dbGroup) return;
    setName(dbGroup.name || '');
    setDesc(dbGroup.description || '');
    setCategory((dbGroup.category || [])?.[0] || 'academic');
    setVisibility(dbGroup.privacy || 'public');
    if (dbGroup.permissions) setPerms(p => ({ ...p, ...dbGroup.permissions }));
    if (dbGroup.rules?.length) setRules([...dbGroup.rules]);
    if (dbGroup.social_links) setSocial({ instagram:'', tiktok:'', website:'', discord:'', ...dbGroup.social_links });
  }, [dbGroup]);

  const CATS = ['Academic','Social','Arts','Sports','Career','Culture'];
  const VIS  = [
    { id:'public',  label:'Public',  sub:'Anyone can find and join',
      icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="C" strokeWidth="2"/><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" stroke="C" strokeWidth="2"/></svg> },
    { id:'private', label:'Private', sub:'Members join by request only',
      icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" stroke="C" strokeWidth="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="C" strokeWidth="2" strokeLinecap="round"/></svg> },
  ];
  const PERMS_LIST = [
    { key:'membersPost',      label:'Members can post',    sub:'Allow all members to create posts' },
    { key:'requireApproval',  label:'Approve posts first', sub:'Posts need admin approval before going live' },
    { key:'allowInvites',     label:'Members can invite',  sub:'Let members invite others to the group' },
  ];
  const SOCIALS = [
    { key:'instagram', label:'Instagram', ph:'@username',
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="5" stroke="#E1306C" strokeWidth="1.9"/><circle cx="12" cy="12" r="3.6" stroke="#E1306C" strokeWidth="1.9"/><circle cx="16.5" cy="7.5" r="1" fill="#E1306C"/></svg> },
    { key:'tiktok',    label:'TikTok',    ph:'@username',
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14 4v9.5a3.5 3.5 0 1 1-3-3.46V13a1 1 0 1 0 1 1V4h2c.3 1.8 1.7 3.2 3.5 3.5v2c-1.3-.1-2.5-.5-3.5-1.2" stroke={C.ink} strokeWidth="1.7" strokeLinejoin="round"/></svg> },
    { key:'website',   label:'Website',   ph:'yourgroup.ca',
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke={C.primary} strokeWidth="1.9"/><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" stroke={C.primary} strokeWidth="1.9"/></svg> },
    { key:'discord',   label:'Discord',   ph:'Invite link',
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M7 7.5C8.5 6.7 10 6.5 12 6.5s3.5.2 5 1c1.8 2.5 2.5 5.5 2.3 9-1.3 1-2.7 1.7-4 2l-.8-1.4M7 7.5c-1.8 2.5-2.5 5.5-2.3 9 1.3 1 2.7 1.7 4 2l.8-1.4M9 14c2 1 4 1 6 0" stroke="#5865F2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  ];

  const Toggle = ({ on, onToggle }) => (
    <button onClick={onToggle} style={{ width:44, height:26, border:'none', borderRadius:999,
      padding:0, background: on ? C.primary : '#D1D5DB', cursor:'pointer',
      position:'relative', transition:'background .2s', flexShrink:0 }}>
      <span style={{ position:'absolute', top:3, left: on ? 21 : 3, width:20, height:20,
                     borderRadius:'50%', background:'#fff', display:'block',
                     boxShadow:'0 1px 3px rgba(0,0,0,0.2)', transition:'left .2s' }}/>
    </button>
  );

  const Field = ({ label, children }) => (
    <div style={{ marginTop:18 }}>
      <div style={{ fontSize:13, fontWeight:700, letterSpacing:0.4,
                    textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
        {label}
      </div>
      {children}
    </div>
  );

  if (isAuthorized === false) {
    return (
      <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center',
                    justifyContent:'center', gap:12, padding:24, textAlign:'center',
                    fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
        <div style={{ fontSize:18, fontWeight:800, color:C.ink }}>Admins only</div>
        <div style={{ fontSize:15, color:C.subtle }}>You need to be an admin of this group to edit it.</div>
        <button onClick={goBack} style={{ marginTop:8, height:44, padding:'0 22px', border:'none',
          borderRadius:999, background:C.ink, color:'#fff', fontWeight:700, cursor:'pointer' }}>Go back</button>
      </div>
    );
  }
  if (isAuthorized === null) {
    return <div style={{ height:'100%', background:C.pageBg }} />;
  }

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      {/* Header */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)',
                    backdropFilter:'blur(16px)', padding:'52px 14px 0',
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', zIndex:4 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, paddingBottom:10 }}>
          <button onClick={goBack} style={{ width:40, height:40, border:'none',
            borderRadius:13, background:C.chip, display:'flex', alignItems:'center',
            justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                        letterSpacing:-0.3, color:C.ink }}>Edit Group</div>
          <button disabled={saving} onClick={async () => {
            setSaving(true);
            const updates = {};
            if (tab === 'info')    { updates.name = name.trim(); updates.description = desc.trim(); updates.category = [category]; updates.initial = name.trim()[0]?.toUpperCase() || 'G'; }
            if (tab === 'privacy') { updates.privacy = visibility; updates.permissions = perms; }
            if (tab === 'rules')   { updates.rules = rules; }
            if (tab === 'social')  { updates.social_links = social; }
            const { error } = await supabase.from('groups').update(updates).eq('id', groupId);
            setSaving(false);
            if (error) { showToast('Failed to save: ' + error.message); return; }
            showToast('Changes saved');
            goBack();
          }} style={{
            height:40, padding:'0 16px', border:'none', borderRadius:13,
            background:'linear-gradient(135deg,#19BFFF,#008FF0)', color:'#fff',
            fontSize:15, fontWeight:800, cursor: saving ? 'default' : 'pointer',
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            boxShadow:'0 4px 10px rgba(2,162,240,0.3)', flexShrink:0,
            opacity: saving ? 0.7 : 1,
          }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
        {/* Tabs — horizontally scrollable */}
        <div style={{ overflowX:'auto', borderBottom:`1px solid ${C.divider}`, display:'flex', scrollbarWidth:'none' }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(tabId(t))} style={{
              flexShrink:0, height:38, padding:'0 14px', border:'none', background:'none', cursor:'pointer',
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              fontSize:15, fontWeight: tabId(t)===tab ? 800 : 600,
              color: tabId(t)===tab ? C.primary : C.subtle,
              borderBottom: `2.5px solid ${tabId(t)===tab ? C.primary : 'transparent'}`,
              marginBottom:-1, whiteSpace:'nowrap',
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'18px 16px 30px' }}>

        {/* ── INFO ── */}
        {tab === 'info' && (
          <>
            {/* Photo */}
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
              <button onClick={() => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = 'image/*';
                input.onchange = async (e) => {
                  const file = e.target.files[0]; if (!file) return;
                  setUploadingIcon(true);
                  try {
                    const url = await uploadImage(file, 'post-media', `groups/${groupId}-${Date.now()}.jpg`);
                    await supabase.from('groups').update({ avatar_url: url }).eq('id', groupId);
                    setAvatarUrl(url);
                    showToast('Group icon updated ✓');
                  } catch(err) { showToast('Upload failed: ' + err.message); }
                  finally { setUploadingIcon(false); }
                };
                input.click();
              }} style={{
                position:'relative', border:'none', background:'none',
                cursor:'pointer', padding:0, opacity: uploadingIcon ? 0.6 : 1,
              }}>
                <div style={{ width:84, height:84, borderRadius:'50%',
                              background:g.logoColor || g.logo_color || "linear-gradient(135deg,#19BFFF,#0098F0)", display:'flex', alignItems:'center',
                              justifyContent:'center', color:'#fff', fontSize:28,
                              fontWeight:800, position:'relative', overflow:'hidden' }}>
                  {avatarUrl
                    ? <img src={avatarUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', position:'absolute', inset:0 }} />
                    : <><span>{g.initial || (g.name || "G")[0].toUpperCase()}</span>
                        <div style={{ position:'absolute', inset:0, background:'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 9px)'}}/></>
                  }
                </div>
                <div style={{ position:'absolute', bottom:0, right:0, width:28, height:28,
                              borderRadius:'50%', background:C.primary,
                              border:`2.5px solid ${C.pageBg}`,
                              display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <rect x="3.5" y="6" width="17" height="13" rx="3" stroke="#fff" strokeWidth="2"/>
                    <circle cx="12" cy="12.5" r="3" stroke="#fff" strokeWidth="2"/>
                  </svg>
                </div>
              </button>
              <div style={{ fontSize:14, fontWeight:700, color: uploadingIcon ? C.subtle : C.primary, marginTop:9 }}>
                {uploadingIcon ? 'Uploading…' : 'Change icon'}
              </div>
            </div>

            {/* Cover photo upload */}
            <div style={{ marginTop:16 }}>
              <label style={{ display:'block', fontSize:13, fontWeight:700, letterSpacing:0.4, textTransform:'uppercase', color:C.subtle, marginBottom:8 }}>Cover Photo</label>
              <label style={{ display:'block', cursor:'pointer' }}>
                <div style={{ height:80, borderRadius:16, overflow:'hidden', position:'relative',
                  background: coverUrl ? 'transparent' : 'linear-gradient(135deg,#1A1F2E,#465067)',
                  border:`1.5px dashed ${C.border}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  {coverUrl
                    ? <img src={coverUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                    : <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="6" width="17" height="13" rx="3" stroke={C.subtle} strokeWidth="1.9"/><circle cx="12" cy="12.5" r="3" stroke={C.subtle} strokeWidth="1.9"/><path d="M8.5 6l1-2h5l1 2" stroke={C.subtle} strokeWidth="1.9" strokeLinejoin="round"/></svg>
                        <span style={{ fontSize:13, color:C.subtle, fontWeight:600 }}>Tap to upload cover</span>
                      </div>}
                  {uploadingCoverEdit && (
                    <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <span style={{ color:'#fff', fontSize:14, fontWeight:700 }}>Uploading…</span>
                    </div>
                  )}
                </div>
                <input type="file" accept="image/*" style={{ display:'none' }} onChange={async (e) => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setUploadingCoverEdit(true);
                  try {
                    const url = await uploadImage(file, 'post-media', `groups/cover-${groupId}.${safeExt(file.name)}`);
                    await supabase.from('groups').update({ cover_url: url }).eq('id', groupId);
                    setCoverUrl(url);
                    showToast('Cover photo updated ✓');
                  } catch(err) { showToast('Upload failed: ' + err.message); }
                  setUploadingCoverEdit(false);
                }}/>
              </label>
            </div>

            <Field label="Group Name">
              <input value={name} onChange={e => setName(e.target.value)}
                style={{ width:'100%', boxSizing:'border-box', height:48,
                         border:`1.5px solid ${C.border}`, borderRadius:14,
                         background:'#fff', padding:'0 14px', fontSize:17,
                         fontWeight:700, color:C.body, outline:'none',
                         fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
            </Field>

            <Field label="Description">
              <textarea value={desc} onChange={e => setDesc(e.target.value)}
                style={{ width:'100%', boxSizing:'border-box', minHeight:96,
                         border:`1.5px solid ${C.border}`, borderRadius:14,
                         background:'#fff', padding:13, fontSize:16, fontWeight:500,
                         lineHeight:1.55, color:C.body, outline:'none', resize:'none',
                         fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
            </Field>

            <Field label="Category">
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {CATS.map(c => {
                  const on = category === c.toLowerCase();
                  return (
                    <button key={c} onClick={() => setCategory(c.toLowerCase())} style={{
                      flexShrink:0, height:36, padding:'0 15px', borderRadius:999,
                      cursor:'pointer', border: on ? 'none' : `1.5px solid ${C.border}`,
                      fontSize:15, fontWeight:700,
                      fontFamily:"'Montserrat',-apple-system,sans-serif",
                      background: on ? C.primary : '#fff',
                      color: on ? '#fff' : C.muted,
                      boxShadow: on ? '0 4px 12px rgba(2,162,240,0.3)' : 'none',
                    }}>{c}</button>
                  );
                })}
              </div>
            </Field>

            {/* Danger Zone */}
            <div style={{ marginTop:32, padding:16, borderRadius:16, border:'1.5px solid #FECACA', background:'#FFF5F5' }}>
              <div style={{ fontSize:15, fontWeight:800, color:'#EF4444', marginBottom:12 }}>Danger Zone</div>
              <button onClick={async () => {
                if (!window.confirm('Delete this group? This cannot be undone.')) return;
                const { error } = await supabase.from('groups').delete().eq('id', groupId);
                if (error) { showToast('Delete failed: ' + error.message); return; }
                showToast('Group deleted');
                goBack();
              }} style={{ width:'100%', height:44, border:'1.5px solid #EF4444', borderRadius:13, background:'#fff', color:'#EF4444', fontSize:15, fontWeight:800, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
                Delete Group
              </button>
            </div>
          </>
        )}

        {/* ── PRIVACY ── */}
        {tab === 'privacy' && (
          <>
            <div style={{ fontSize:15, color:C.muted, lineHeight:1.55, marginBottom:18 }}>
              Control who can find and join your group, and what members are allowed to do.
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {VIS.map(v => {
                const on  = visibility === v.id;
                return (
                  <button key={v.id} onClick={() => setVisibility(v.id)} style={{
                    display:'flex', alignItems:'center', gap:13, width:'100%',
                    borderRadius:16, padding:15, cursor:'pointer',
                    fontFamily:"'Montserrat',-apple-system,sans-serif", textAlign:'left',
                    background: on ? '#EAF6FF' : '#fff',
                    border: on ? `2px solid ${C.primary}` : `2px solid ${C.border}`,
                  }}>
                    <div style={{ width:40, height:40, borderRadius:11, flexShrink:0,
                                  background: on ? '#D6EEFF' : C.chip,
                                  display:'flex', alignItems:'center',
                                  justifyContent:'center' }}>
                      {v.icon}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:17, fontWeight:800, color:C.ink }}>{v.label}</div>
                      <div style={{ fontSize:14, color:C.subtle, marginTop:2 }}>{v.sub}</div>
                    </div>
                    <div style={{ width:22, height:22, borderRadius:'50%', flexShrink:0,
                                  border: on ? 'none' : `2px solid ${C.border}`,
                                  background: on ? C.primary : '#fff',
                                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <path d="m5 12.5 4.5 4.5L19 7" stroke="#fff" strokeWidth="3"
                              strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>}
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{ background:'#fff', borderRadius:18,
                          boxShadow:'0 4px 14px rgba(16,24,40,0.05)',
                          padding:'0 16px', marginTop:18 }}>
              {PERMS_LIST.map((p, i) => (
                <div key={p.key} style={{ display:'flex', alignItems:'center', gap:12,
                                           padding:'14px 0',
                                           borderBottom: i<PERMS_LIST.length-1 ? `1px solid ${C.divider}` : 'none' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:16, fontWeight:700, color:C.ink }}>{p.label}</div>
                    <div style={{ fontSize:13.5, color:C.subtle, marginTop:2 }}>{p.sub}</div>
                  </div>
                  <Toggle on={perms[p.key]}
                    onToggle={() => setPerms(s => ({ ...s, [p.key]: !s[p.key] }))}/>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── RULES ── */}
        {tab === 'rules' && (
          <>
            <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
              {rules.map((r, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:10,
                                       background:'#fff', border:`1.5px solid ${C.border}`,
                                       borderRadius:14, padding:'11px 13px' }}>
                  <div style={{ width:24, height:24, borderRadius:7, flexShrink:0,
                                background:'#E9F6FF', display:'flex', alignItems:'center',
                                justifyContent:'center', fontSize:14,
                                fontWeight:800, color:C.primary }}>{i+1}</div>
                  <span style={{ flex:1, fontSize:15, fontWeight:600, color:C.body,
                                 lineHeight:1.4 }}>{r}</span>
                  <button onClick={() => setRules(s => s.filter((_,idx) => idx!==i))}
                    style={{ width:26, height:26, border:'none', borderRadius:8,
                             background:C.chip, display:'flex', alignItems:'center',
                             justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M6 6l12 12M18 6L6 18" stroke={C.subtle} strokeWidth="2.2"
                            strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', gap:8, marginTop:10 }}>
              <input value={ruleDraft} onChange={e => setRuleDraft(e.target.value)}
                onKeyDown={e => { if (e.key==='Enter' && ruleDraft.trim()) {
                  setRules(s => [...s, ruleDraft.trim()]); setRuleDraft(''); }}}
                placeholder="Add a custom rule…"
                style={{ flex:1, height:44, border:`1.5px solid ${C.border}`, borderRadius:13,
                         background:'#fff', padding:'0 13px', fontSize:15,
                         fontWeight:600, color:C.body, outline:'none',
                         fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
              <button onClick={() => {
                if (!ruleDraft.trim()) return;
                setRules(s => [...s, ruleDraft.trim()]); setRuleDraft('');
              }} style={{ width:44, height:44, border:'none', borderRadius:13,
                          background:C.primary, display:'flex', alignItems:'center',
                          justifyContent:'center', cursor:'pointer',
                          boxShadow:'0 4px 10px rgba(2,162,240,0.3)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.4"
                        strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          </>
        )}

        {/* ── SOCIAL ── */}
        {tab === 'social' && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {SOCIALS.map(s => (
              <div key={s.key}>
                <div style={{ fontSize:13, fontWeight:700, letterSpacing:0.4,
                              textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
                  {s.label}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:11,
                              background:'#fff', border:`1.5px solid ${C.border}`,
                              borderRadius:14, padding:'0 15px', height:50 }}>
                  <div style={{ flexShrink:0 }}>{s.icon}</div>
                  <input value={social[s.key]}
                    onChange={e => setSocial(prev => ({ ...prev, [s.key]: e.target.value }))}
                    placeholder={s.ph}
                    style={{ flex:1, border:'none', background:'none', outline:'none',
                             fontSize:16, fontWeight:600, color:C.body,
                             fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── MEMBERS ── */}
        {tab === 'members' && (
          <div>
            <div style={{ fontSize:15, color:C.muted, marginBottom:14 }}>Manage who's in your group. Remove members or change their roles.</div>
            {membersLoading && <div style={{ textAlign:'center', color:C.subtle, padding:'40px 0', fontSize:15 }}>Loading members…</div>}
            {!membersLoading && members.length === 0 && <div style={{ textAlign:'center', color:C.subtle, padding:'40px 0', fontSize:15 }}>No members yet</div>}
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {members.map(m => {
                const u = m.users || {};
                const displayName = u.name || m.user_id?.slice(0,8) || 'Member';
                const isAdmin = m.role === 'admin' || m.role === 'owner';
                return (
                  <div key={m.user_id} style={{ display:'flex', alignItems:'center', gap:12, background:'#fff', borderRadius:16, padding:'12px 14px', boxShadow:'0 2px 8px rgba(16,24,40,0.05)' }}>
                    <div style={{ width:44, height:44, borderRadius:'50%', flexShrink:0, background: u.avatar_color || C.grad, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:800, color:'#fff', overflow:'hidden' }}>
                      {u.avatar_url ? <img src={u.avatar_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : displayName[0]?.toUpperCase()}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:15, fontWeight:800, color:C.ink }}>{displayName}</div>
                      <div style={{ fontSize:13, color: isAdmin ? C.primary : C.subtle, marginTop:2, fontWeight: isAdmin ? 700 : 500 }}>{m.role || 'member'}</div>
                    </div>
                    <div style={{ display:'flex', gap:7 }}>
                      <button onClick={async () => {
                        const newRole = isAdmin ? 'member' : 'admin';
                        try {
                          const { data, error } = await supabase.from('group_members').update({ role: newRole }).eq('group_id', groupId).eq('user_id', m.user_id).select();
                          if (error) { showToast('Failed to update role: ' + error.message); return; }
                          // RLS can silently match zero rows (no error, no update) rather
                          // than reject -- only treat it as success if a row came back.
                          if (!data?.length) { showToast('Failed to update role'); return; }
                          setMembers(prev => prev.map(x => x.user_id === m.user_id ? { ...x, role: newRole } : x));
                          showToast(isAdmin ? 'Removed admin' : 'Made admin ✓');
                        } catch {
                          // A network-level failure rejects rather than resolving with
                          // `error` -- catch it too so the click doesn't silently no-op.
                          showToast('Failed to update role');
                        }
                      }} style={{ height:32, padding:'0 12px', border:`1.5px solid ${C.border}`, borderRadius:10, background:'#fff', fontSize:13, fontWeight:700, color:C.body, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
                        {isAdmin ? 'Demote' : 'Make Admin'}
                      </button>
                      <button onClick={async () => {
                        if (!window.confirm(`Remove ${displayName} from the group?`)) return;
                        try {
                          const { data, error } = await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', m.user_id).select();
                          if (error) { showToast('Failed to remove member: ' + error.message); return; }
                          if (!data?.length) { showToast('Failed to remove member'); return; }
                          setMembers(prev => prev.filter(x => x.user_id !== m.user_id));
                          showToast('Member removed');
                        } catch {
                          showToast('Failed to remove member');
                        }
                      }} style={{ width:32, height:32, border:'none', borderRadius:10, background:'#FFF0F0', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#EF4444" strokeWidth="2.2" strokeLinecap="round"/></svg>
                      </button>
                      {!isAdmin && (
                        <button onClick={async () => {
                          if (!window.confirm(`Ban ${displayName} from this group? They won't be able to rejoin until unbanned.`)) return;
                          const reason = window.prompt('Reason for ban (optional):') || null;
                          try {
                            const { data, error } = await supabase.from('group_members').update({
                              status: 'banned', ban_reason: reason, banned_by: currentUser?.userId || null, banned_at: new Date().toISOString(),
                            }).eq('group_id', groupId).eq('user_id', m.user_id).select();
                            if (error) { showToast('Failed to ban member: ' + error.message); return; }
                            if (!data?.length) { showToast('Failed to ban member'); return; }
                            setMembers(prev => prev.filter(x => x.user_id !== m.user_id));
                            showToast(`${displayName} has been banned`);
                          } catch {
                            showToast('Failed to ban member');
                          }
                        }} style={{ height:32, padding:'0 12px', border:'none', borderRadius:10, background:'#FFF0F0', fontSize:13, fontWeight:700, color:'#EF4444', cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
                          Ban
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── ANALYTICS ── */}
        {tab === 'analytics' && (
          <div>
            {/* Stat cards */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:18 }}>
              {[
                { label:'Total Members', value: analytics.memberCount || '—', icon:'👥', color:'#E9F6FF', text:C.primary },
                { label:'Total Posts',   value: analytics.postCount || '—',   icon:'📝', color:'#F0FDF4', text:'#10B981' },
                { label:'New This Week', value: analytics.newMembersWeek || '—', icon:'📈', color:'#FFF7ED', text:'#F59E0B' },
                { label:'Engagement',    value: analytics.postCount > 0 ? Math.round((analytics.memberCount / Math.max(analytics.postCount,1)) * 10) / 10 + 'x' : '—', icon:'⚡', color:'#F5F3FF', text:'#7C5CFF' },
              ].map(stat => (
                <div key={stat.label} style={{ background:stat.color, borderRadius:18, padding:'16px 14px' }}>
                  <div style={{ fontSize:24, marginBottom:6 }}>{stat.icon}</div>
                  <div style={{ fontSize:26, fontWeight:800, color:stat.text, letterSpacing:-0.5 }}>{stat.value}</div>
                  <div style={{ fontSize:13, fontWeight:600, color:C.subtle, marginTop:3 }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Top members */}
            {analytics.topMembers.length > 0 && (
              <div style={{ background:'#fff', borderRadius:18, padding:'14px 16px', boxShadow:'0 2px 10px rgba(16,24,40,0.06)' }}>
                <div style={{ fontSize:15, fontWeight:800, color:C.ink, marginBottom:12 }}>Founding Members</div>
                {analytics.topMembers.map((m, i) => {
                  const u = m.users || {};
                  const name = u.name || 'Member';
                  return (
                    <div key={m.user_id} style={{ display:'flex', alignItems:'center', gap:10, paddingBottom: i < analytics.topMembers.length-1 ? 10 : 0, marginBottom: i < analytics.topMembers.length-1 ? 10 : 0, borderBottom: i < analytics.topMembers.length-1 ? `1px solid ${C.divider}` : 'none' }}>
                      <div style={{ width:10, height:10, borderRadius:'50%', background:['#F59E0B','#9AA3B2','#CD7F32'][i] || C.subtle, flexShrink:0 }} />
                      <div style={{ width:34, height:34, borderRadius:'50%', flexShrink:0, background: u.avatar_color || C.grad, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:800, color:'#fff', overflow:'hidden' }}>
                        {u.avatar_url ? <img src={u.avatar_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : name[0]?.toUpperCase()}
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:15, fontWeight:700, color:C.ink }}>{name}</div>
                        <div style={{ fontSize:12, color:C.subtle }}>{m.role || 'member'}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginTop:14, background:'#F8FAFC', borderRadius:16, padding:'14px 16px' }}>
              <div style={{ fontSize:14, color:C.subtle, lineHeight:1.6 }}>
                📊 More detailed analytics — post reach, member activity charts, and retention metrics — will be available in the Riply admin dashboard.
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// SCREEN: CHECK-IN
// ─────────────────────────────────────────────────────────────
function CheckInScreen({ eventId, goBack, showToast }) {
  const { event: dbEvent, loading: eventLoading } = useEvent(eventId);
  const mockEv = EVENTS.find(e => e.id === eventId);
  const eventTitle = eventLoading ? 'Loading…' : ((dbEvent || mockEv)?.title || 'Event');

  const [checkedIn, setCheckedIn] = useState(0);
  const [total,     setTotal]     = useState(0);
  const [result,    setResult]    = useState(null);
  const [recent,    setRecent]    = useState([]);
  const [cameraError, setCameraError] = useState(null);
  const [manualId,  setManualId]  = useState('');

  const videoRef      = useRef(null);
  const canvasRef      = useRef(null);
  const streamRef      = useRef(null);
  const rafRef         = useRef(null);
  const processingRef  = useRef(false);
  const pausedRef      = useRef(false);
  const resultTimerRef = useRef(null);

  // Real attendee totals -- how many tickets exist for this event, and how
  // many are already marked used, instead of a hardcoded 142/200.
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      const [{ count: totalCount }, { count: usedCount }] = await Promise.all([
        supabase.from('tickets').select('*', { count:'exact', head:true }).eq('event_id', eventId),
        supabase.from('tickets').select('*', { count:'exact', head:true }).eq('event_id', eventId).eq('status', 'USED'),
      ]);
      if (!cancelled) { setTotal(totalCount || 0); setCheckedIn(usedCount || 0); }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  const showResult = useCallback((r) => {
    setResult(r);
    pausedRef.current = true;
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => { setResult(null); pausedRef.current = false; }, 1800);
  }, []);

  // Validates + marks the ticket used via a security-definer RPC (not a
  // direct update) -- tickets_update RLS only allows the ticket's own owner
  // to touch their row, so the organizer needs a function that checks
  // "am I this event's organizer" server-side rather than opening up
  // tickets_update to anyone, which would let an organizer edit ticket
  // fields beyond just status.
  const handleScan = useCallback(async (ticketId) => {
    const id = ticketId.trim();
    if (!id || processingRef.current) return;
    processingRef.current = true;
    pausedRef.current = true;
    try {
      const { data, error } = await supabase.rpc('check_in_ticket', { p_ticket_id: id, p_event_id: eventId });
      if (error) {
        showResult({ valid:false, name:null, reason: error.message || 'Invalid ticket' });
      } else {
        const row = data?.[0];
        const name = row?.user_name || 'Attendee';
        showResult({ valid:true, name, ticket: row?.access || 'Ticket' });
        setCheckedIn(n => n + 1);
        setRecent(r => [{ name, initial:(name[0] || '?').toUpperCase(),
                           color:'linear-gradient(135deg,#19BFFF,#0098F0)', time:'just now' }, ...r].slice(0, 6));
      }
    } catch (err) {
      // supabase.rpc() throwing (network failure, etc.) rather than resolving
      // with {data, error} previously left processingRef/pausedRef stuck true
      // forever, freezing the scanner for the rest of the session with no
      // recovery short of a reload.
      console.error('[handleScan] error:', err);
      showResult({ valid:false, name:null, reason: 'Scan failed — try again' });
    } finally {
      processingRef.current = false;
    }
  }, [eventId, showResult]);

  // Camera + scan loop: grab a video frame onto the hidden canvas every
  // animation frame and hand the pixels to jsQR; a decoded QR payload is the
  // ticket's id, which handleScan looks up server-side.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const video = videoRef.current, canvas = canvasRef.current;
      if (!video || !canvas || processingRef.current || pausedRef.current) return;
      if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code?.data) handleScan(code.data);
    };
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        tick();
      } catch {
        if (!cancelled) setCameraError('Camera unavailable — check browser permissions, or check in manually below.');
      }
    })();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, [handleScan]);

  useEffect(() => () => {
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
  }, []);

  const pct = total > 0 ? Math.round((checkedIn / total) * 100) : 0;

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:'#0B1018', fontFamily:"'Montserrat',-apple-system,sans-serif",
                  position:'relative', overflow:'hidden' }}>

      {/* Header */}
      <div style={{ flexShrink:0, padding:'52px 16px 14px', display:'flex',
                    alignItems:'center', gap:10, position:'relative', zIndex:4 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none',
          borderRadius:13, background:'rgba(255,255,255,0.12)', display:'flex',
          alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#fff" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:19, fontWeight:800, letterSpacing:-0.3, color:'#fff' }}>
            Check-In
          </div>
          <div style={{ fontSize:14, color:'rgba(255,255,255,0.55)', marginTop:1 }}>
            {eventTitle} · Organizer
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(34,197,94,0.18)',
                      height:30, padding:'0 11px', borderRadius:999 }}>
          <span style={{ width:7, height:7, borderRadius:'50%', background:'#22C55E',
                         display:'block', flexShrink:0 }}/>
          <span style={{ fontSize:13.5, fontWeight:800, color:'#4ADE80' }}>Scanning</span>
        </div>
      </div>

      {/* Progress */}
      <div style={{ flexShrink:0, padding:'4px 18px 16px', position:'relative', zIndex:4 }}>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between',
                      marginBottom:9 }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
            <span style={{ fontSize:32, fontWeight:800, color:'#fff', letterSpacing:-1 }}>
              {checkedIn}
            </span>
            <span style={{ fontSize:17, fontWeight:600, color:'rgba(255,255,255,0.55)' }}>
              / {total} checked in
            </span>
          </div>
          <span style={{ fontSize:15, fontWeight:800, color:'#19BFFF' }}>{pct}%</span>
        </div>
        <div style={{ height:8, borderRadius:999, background:'rgba(255,255,255,0.12)',
                      overflow:'hidden' }}>
          <div style={{ height:'100%', borderRadius:999, transition:'width .4s ease',
                        width:`${pct}%`,
                        background:'linear-gradient(90deg,#19BFFF,#0098F0)' }}/>
        </div>
      </div>

      {/* Scanner viewport */}
      <div style={{ flex:1, position:'relative', margin:'0 18px', borderRadius:24,
                    overflow:'hidden',
                    background:'linear-gradient(160deg,#16202C,#0C1219)', minHeight:0 }}>
        <video ref={videoRef} playsInline muted style={{
          position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover',
          opacity: cameraError ? 0 : 1,
        }}/>
        <canvas ref={canvasRef} style={{ display:'none' }}/>

        {cameraError ? (
          <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
                        alignItems:'center', justifyContent:'center', gap:8, padding:24,
                        textAlign:'center' }}>
            <span style={{ fontSize:15, fontWeight:700, color:'rgba(255,255,255,0.75)' }}>{cameraError}</span>
          </div>
        ) : (
          <>
            <div style={{ position:'absolute', top:14, left:'50%', transform:'translateX(-50%)',
                          fontFamily:"'JetBrains Mono',monospace", fontSize:12, letterSpacing:1,
                          color:'rgba(255,255,255,0.7)', textShadow:'0 1px 4px rgba(0,0,0,0.6)' }}>
              POINT AT ATTENDEE QR
            </div>

            {/* Reticle */}
            <div style={{ position:'absolute', top:'50%', left:'50%',
                          transform:'translate(-50%,-50%)', width:208, height:208 }}>
              {[
                { top:0,  left:0,  borderTop:`4px solid #19BFFF`, borderLeft:`4px solid #19BFFF`,  borderRadius:'14px 0 0 0' },
                { top:0,  right:0, borderTop:`4px solid #19BFFF`, borderRight:`4px solid #19BFFF`, borderRadius:'0 14px 0 0' },
                { bottom:0, left:0, borderBottom:`4px solid #19BFFF`, borderLeft:`4px solid #19BFFF`, borderRadius:'0 0 0 14px' },
                { bottom:0, right:0, borderBottom:`4px solid #19BFFF`, borderRight:`4px solid #19BFFF`, borderRadius:'0 0 14px 0' },
              ].map((s, i) => (
                <div key={i} style={{ position:'absolute', width:38, height:38, ...s }}/>
              ))}
            </div>
          </>
        )}

        {/* Result overlay */}
        {result && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center',
                        justifyContent:'center',
                        background: result.valid
                          ? 'rgba(21,163,74,0.88)' : 'rgba(229,72,77,0.88)',
                        backdropFilter:'blur(4px)' }}>
            <div style={{ textAlign:'center', padding:24 }}>
              {result.valid ? (
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.2)"/>
                  <path d="m6 12 3.5 3.5L18 8" stroke="#fff" strokeWidth="3"
                        strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              ) : (
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.2)"/>
                  <path d="M7 7l10 10M17 7L7 17" stroke="#fff" strokeWidth="3"
                        strokeLinecap="round"/>
                </svg>
              )}
              <div style={{ fontSize:22, fontWeight:800, color:'#fff', marginTop:12 }}>
                {result.valid ? 'Valid Ticket' : 'Invalid'}
              </div>
              <div style={{ fontSize:17, fontWeight:700, color:'rgba(255,255,255,0.9)',
                            marginTop:5 }}>{result.name}</div>
              <div style={{ fontSize:14, color:'rgba(255,255,255,0.75)', marginTop:3 }}>
                {result.valid ? result.ticket : result.reason}
              </div>
            </div>
          </div>
        )}

        {/* Recent list */}
        {recent.length > 0 && !result && (
          <div style={{ position:'absolute', bottom:14, left:14, right:14,
                        display:'flex', flexDirection:'column', gap:7 }}>
            {recent.slice(0,3).map((a, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:9,
                                     background:'rgba(255,255,255,0.08)',
                                     backdropFilter:'blur(8px)',
                                     borderRadius:12, padding:'8px 11px' }}>
                <div style={{ width:28, height:28, borderRadius:'50%', flexShrink:0,
                              background:a.color, display:'flex', alignItems:'center',
                              justifyContent:'center', fontSize:11, fontWeight:800,
                              color:'#fff' }}>{a.initial}</div>
                <span style={{ flex:1, fontSize:14, fontWeight:700, color:'rgba(255,255,255,0.9)' }}>
                  {a.name}
                </span>
                <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,0.5)' }}>
                  {a.time}
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" fill="#10B981"/>
                  <path d="m7.5 12 2.5 2.5L16.5 9" stroke="#fff" strokeWidth="2.2"
                        strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Manual entry fallback -- for when the camera is unavailable, or the
          attendee's QR is glared out on their screen */}
      <div style={{ flexShrink:0, padding:'16px 18px 30px', zIndex:4 }}>
        <div style={{ display:'flex', gap:8 }}>
          <input value={manualId} onChange={e => setManualId(e.target.value)}
            placeholder="Or type ticket ID"
            onKeyDown={e => { if (e.key === 'Enter' && manualId.trim()) { handleScan(manualId.trim()); setManualId(''); } }}
            style={{ flex:1, height:50, borderRadius:16, border:'1.5px solid rgba(255,255,255,0.14)',
                     background:'rgba(255,255,255,0.06)', color:'#fff', padding:'0 16px',
                     fontSize:15, fontFamily:"'JetBrains Mono',monospace", outline:'none' }}/>
          <button
            disabled={!manualId.trim()}
            onClick={() => { handleScan(manualId.trim()); setManualId(''); }}
            style={{
              height:50, padding:'0 22px', border:'none', borderRadius:16,
              cursor: manualId.trim() ? 'pointer' : 'not-allowed',
              background: manualId.trim() ? 'linear-gradient(135deg,#19BFFF,#008FF0)' : 'rgba(255,255,255,0.08)',
              color: manualId.trim() ? '#fff' : 'rgba(255,255,255,0.35)',
              fontSize:16, fontWeight:800,
              fontFamily:"'Montserrat',-apple-system,sans-serif",
            }}>
            Check In
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: REVIEW
// ─────────────────────────────────────────────────────────────
function ReviewScreen({ ticketId, goBack, navigate, showToast }) {
  const { user } = useUser();
  const [tk, setTk] = useState(TICKETS_DATA.find(t => t.id === ticketId) || TICKETS_DATA[0]);

  useEffect(() => {
    if (!ticketId || !user?.id) return;
    supabase.from('tickets').select('*').eq('id', ticketId).single()
      .then(({ data }) => { if (data) setTk(data); });
  }, [ticketId, user?.id]);

  const LABELS  = ['','Poor','Fair','Good','Great','Loved it!'];
  const ASPECTS = [
    { id:'venue', label:'Venue & atmosphere' },
    { id:'org',   label:'Organisation' },
    { id:'value', label:'Value for money' },
  ];
  const TAGS = ['Great vibe','Well organized','Friendly crowd','Good music','Worth the price','Would return'];

  const [rating,    setRating]    = useState(0);
  const [aspects,   setAspects]   = useState({ venue:0, org:0, value:0 });
  const [tags,      setTags]      = useState({});
  const [review,    setReview]    = useState('');
  const [recommend, setRecommend] = useState(true);
  const [sent,      setSent]      = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = rating > 0;

  const Star = ({ filled, size=30, onClick }) => (
    <button onClick={onClick} style={{ border:'none', background:'none', cursor:'pointer',
      padding:2, display:'flex' }}>
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.8 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3Z"
              fill={filled ? '#FFB020' : 'none'}
              stroke={filled ? '#F59E0B' : '#D4D9E2'}
              strokeWidth="1.6" strokeLinejoin="round"/>
      </svg>
    </button>
  );

  if (sent) return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      <div style={{ flexShrink:0, background:'#fff', padding:'52px 14px 12px',
                    display:'flex', alignItems:'center', gap:8,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.06)' }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none', borderRadius:13,
          background:C.chip, display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Write a Review</div>
        <div style={{ width:40 }}/>
      </div>
      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center',
                    textAlign:'center', padding:'56px 24px 0', overflowY:'auto' }}>
        <div style={{ width:88, height:88, borderRadius:'50%', background:'#E4F7EC',
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ width:60, height:60, borderRadius:'50%',
                        background:'linear-gradient(135deg,#22C55E,#15A34A)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        boxShadow:'0 8px 20px rgba(21,163,74,0.4)' }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
              <path d="m5 12.5 4.5 4.5L19 7" stroke="#fff" strokeWidth="3"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
        <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.5,
                      color:C.ink, marginTop:22 }}>Review posted!</div>
        <div style={{ fontSize:15.5, lineHeight:1.55, color:'#7B8499', marginTop:9,
                      maxWidth:280 }}>
          Thanks for sharing your experience. Your review helps other students decide which events to attend.
        </div>
        <div style={{ display:'flex', justifyContent:'center', gap:3, marginTop:18 }}>
          {[1,2,3,4,5].map(n => (
            <svg key={n} width="18" height="18" viewBox="0 0 24 24">
              <path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.8 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3Z"
                    fill={n<=rating?'#FFB020':'none'}
                    stroke={n<=rating?'#F59E0B':'#D4D9E2'}
                    strokeWidth="1.6" strokeLinejoin="round"/>
            </svg>
          ))}
        </div>
        <button onClick={() => { goBack(); }} style={{
          width:'100%', height:52, marginTop:24, border:'none', borderRadius:16,
          background:C.grad, color:'#fff', fontSize:18, fontWeight:800, cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          boxShadow:'0 8px 20px rgba(2,162,240,0.4)',
        }}>Discover more events</button>
        <button onClick={() => setSent(false)} style={{ border:'none', background:'none',
          cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
          fontSize:15.5, fontWeight:700, color:C.primary, marginTop:16 }}>
          Write another review
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink:0, background:'#fff', padding:'52px 14px 12px',
                    display:'flex', alignItems:'center', gap:8,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.06)', zIndex:4 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none', borderRadius:13,
          background:C.chip, display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Write a Review</div>
        <div style={{ width:40 }}/>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'18px 16px 30px' }}>
        {/* Event card */}
        <div style={{ display:'flex', alignItems:'center', gap:13, background:'#fff',
                      borderRadius:18, padding:13,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
          <div style={{ width:60, height:60, borderRadius:14, flexShrink:0,
                        background:'linear-gradient(135deg,#FF5A8A,#FF8A3D)',
                        position:'relative', overflow:'hidden', display:'flex',
                        alignItems:'center', justifyContent:'center' }}>
            <div style={{ position:'absolute', inset:0, background:
              'repeating-linear-gradient(135deg,rgba(255,255,255,0.14) 0,rgba(255,255,255,0.14) 2px,transparent 2px,transparent 9px)'}}/>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ position:'relative' }}>
              <path d="M9 18V6l10-2v12" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="6.5" cy="18" r="2.5" stroke="#fff" strokeWidth="2"/>
              <circle cx="16.5" cy="16" r="2.5" stroke="#fff" strokeWidth="2"/>
            </svg>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <span style={{ display:'inline-flex', alignItems:'center', height:20,
                           padding:'0 8px', borderRadius:6, background:'#E4F7EC',
                           fontSize:12, fontWeight:800, color:'#15A34A' }}>ATTENDED</span>
            <div style={{ fontSize:18, fontWeight:800, color:C.ink, marginTop:5 }}>
              {tk?.eventTitle || 'Karaoke Night'}
            </div>
            <div style={{ fontSize:13.5, color:C.subtle, marginTop:2 }}>
              {tk?.date || 'Jan 15, 2026'} · University Centre
            </div>
          </div>
        </div>

        {/* Overall rating */}
        <div style={{ textAlign:'center', marginTop:24 }}>
          <div style={{ fontSize:18, fontWeight:800, color:C.ink }}>How was the event?</div>
          <div style={{ display:'flex', justifyContent:'center', gap:6, marginTop:14 }}>
            {[1,2,3,4,5].map(n => (
              <Star key={n} filled={n<=rating} onClick={() => setRating(n)}/>
            ))}
          </div>
          <div style={{ fontSize:15, fontWeight:700, color:C.primary, marginTop:10, height:18 }}>
            {LABELS[rating]}
          </div>
        </div>

        {/* Aspect ratings */}
        <div style={{ fontSize:13, fontWeight:800, letterSpacing:0.5,
                      textTransform:'uppercase', color:C.subtle,
                      margin:'22px 4px 10px' }}>Rate the details</div>
        <div style={{ background:'#fff', borderRadius:18,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)', overflow:'hidden' }}>
          {ASPECTS.map((a, i) => (
            <div key={a.id} style={{ display:'flex', alignItems:'center', gap:10,
                                      padding:'14px 15px',
                                      borderBottom: i<ASPECTS.length-1 ? `1px solid ${C.divider}` : 'none' }}>
              <span style={{ flex:1, fontSize:16, fontWeight:700, color:C.ink }}>
                {a.label}
              </span>
              <div style={{ display:'flex', gap:3 }}>
                {[1,2,3,4,5].map(n => (
                  <Star key={n} filled={n<=aspects[a.id]} size={22}
                    onClick={() => setAspects(s => ({ ...s, [a.id]: n }))}/>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Tags */}
        <div style={{ fontSize:13, fontWeight:800, letterSpacing:0.5,
                      textTransform:'uppercase', color:C.subtle,
                      margin:'22px 4px 10px' }}>What stood out?</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:9 }}>
          {TAGS.map(t => {
            const on = !!tags[t];
            return (
              <button key={t} onClick={() => setTags(s => ({ ...s, [t]: !s[t] }))} style={{
                border: on ? 'none' : `1.5px solid ${C.border}`,
                cursor:'pointer', height:38, padding:'0 16px', borderRadius:999,
                fontSize:15, fontWeight:700,
                fontFamily:"'Montserrat',-apple-system,sans-serif",
                background: on ? C.primary : '#fff',
                color: on ? '#fff' : C.muted,
                boxShadow: on ? '0 4px 12px rgba(2,162,240,0.3)' : 'none',
              }}>{t}</button>
            );
          })}
        </div>

        {/* Written review */}
        <div style={{ fontSize:13, fontWeight:800, letterSpacing:0.5,
                      textTransform:'uppercase', color:C.subtle,
                      margin:'22px 4px 10px' }}>Your review</div>
        <textarea value={review} onChange={e => setReview(e.target.value)}
          placeholder="What did you love? What could be better?"
          style={{ width:'100%', boxSizing:'border-box', minHeight:100,
                   border:`1.5px solid ${C.border}`, borderRadius:16,
                   background:'#fff', padding:14, fontSize:15.5, fontWeight:500,
                   lineHeight:1.55, color:C.body, outline:'none', resize:'none',
                   fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>

        {/* Recommend toggle */}
        <div style={{ display:'flex', alignItems:'center', gap:12, marginTop:16,
                      background:'#fff', borderRadius:16, padding:15,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:16, fontWeight:700, color:C.ink }}>
              Would you recommend this event?
            </div>
          </div>
          <button onClick={() => setRecommend(v => !v)} style={{
            width:44, height:26, border:'none', borderRadius:999, padding:0,
            background: recommend ? C.primary : '#D1D5DB', cursor:'pointer',
            position:'relative', transition:'background .2s', flexShrink:0,
          }}>
            <span style={{ position:'absolute', top:3,
                           left: recommend ? 21 : 3, width:20, height:20,
                           borderRadius:'50%', background:'#fff', display:'block',
                           boxShadow:'0 1px 3px rgba(0,0,0,0.2)', transition:'left .2s' }}/>
          </button>
        </div>

        {/* Submit */}
        <button onClick={async () => {
          if (!canSubmit) { showToast('Add a star rating first'); return; }
          setSubmitting(true);
          const { error } = await supabase.from('event_reviews').insert({
            user_id:      user?.id,
            event_id:     tk?.event_id || null,
            ticket_id:    tk?.id || null,
            event_title:  tk?.title || tk?.eventTitle || '',
            rating,
            venue_rating: aspects.venue,
            org_rating:   aspects.org,
            value_rating: aspects.value,
            tags:         Object.keys(tags).filter(k => tags[k]),
            body:         review.trim(),
            recommend,
          });
          setSubmitting(false);
          if (error) { showToast('Failed to submit. Try again.'); return; }
          setSent(true);
        }} style={{
          width:'100%', height:52, marginTop:22, border:'none', borderRadius:16,
          fontSize:18, fontWeight:800, cursor: canSubmit ? 'pointer' : 'not-allowed',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          background: canSubmit ? 'linear-gradient(135deg,#19BFFF,#008FF0)' : '#E4E8EF',
          color: canSubmit ? '#fff' : '#A8B0BD',
          boxShadow: canSubmit ? '0 8px 20px rgba(2,162,240,0.4)' : 'none',
          opacity: submitting ? 0.7 : 1,
        }}>{submitting ? 'Posting…' : 'Post Review'}</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: EVENT MANAGER
// ─────────────────────────────────────────────────────────────
const EVENT_MANAGER_GRADIENTS = [
  'linear-gradient(135deg,#2F6BFF,#6C4DF2)',
  'linear-gradient(135deg,#FF5A8A,#FF8A3D)',
  'linear-gradient(135deg,#0EA5E9,#0E84E0)',
  'linear-gradient(135deg,#7C5CFF,#B06BFF)',
  'linear-gradient(135deg,#10B981,#06B6D4)',
];

function EventManagerScreen({ goBack, navigate, showToast, currentUser }) {
  const TABS = ['live','draft','past','cancelled'];

  const [tab,      setTab]      = useState('live');
  const [events,   setEvents]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [deleting, setDeleting] = useState({});

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const userId = currentUser?.userId;
      if (!userId) { if (!cancelled) setLoading(false); return; }
      setLoading(true);
      const { data: myEvents, error } = await supabase
        .from('events').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error('[event-manager] failed to load events:', error);
        showToast('Could not load your events');
        setEvents([]);
        setLoading(false);
        return;
      }

      const rows = myEvents || [];
      const ids = rows.map(e => e.id);
      let ticketCounts = {};
      let likeCounts = {};
      if (ids.length) {
        const [{ data: ticketRows, error: ticketErr }, { data: likeRows, error: likeErr }] = await Promise.all([
          supabase.from('tickets').select('event_id').in('event_id', ids),
          supabase.from('event_likes').select('event_id').in('event_id', ids),
        ]);
        if (ticketErr) console.error('[event-manager] failed to load ticket counts:', ticketErr);
        if (likeErr) console.error('[event-manager] failed to load like counts:', likeErr);
        (ticketRows || []).forEach(t => { ticketCounts[t.event_id] = (ticketCounts[t.event_id] || 0) + 1; });
        (likeRows || []).forEach(l => { likeCounts[l.event_id] = (likeCounts[l.event_id] || 0) + 1; });
      }

      if (!cancelled) {
        setEvents(rows.map((ev, i) => ({
          ...ev,
          sold: ticketCounts[ev.id] || 0,
          likeCount: likeCounts[ev.id] || 0,
          grad: EVENT_MANAGER_GRADIENTS[i % EVENT_MANAGER_GRADIENTS.length],
        })));
        setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [currentUser?.userId]);

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const eventTab = (ev) => {
    if (ev.status === 'cancelled') return 'cancelled';
    if (ev.status === 'draft') return 'draft';
    const d = new Date(ev.full_date || ev.date || '');
    if (!isNaN(d) && d < todayStart) return 'past';
    return 'live';
  };

  const list = events.filter(e => eventTab(e) === tab && !deleting[e.id]);

  const totals = events.reduce((acc, e) => {
    const { isFree, amount } = parseEventPrice(e.price);
    acc.revenue += isFree ? 0 : amount * e.sold;
    acc.rsvps   += e.sold;
    acc.likes   += e.likeCount;
    return acc;
  }, { revenue: 0, rsvps: 0, likes: 0 });

  const fmtMoney = (n) => n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n}`;
  const fmtCount = (n) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;

  // An event with sold tickets can't be hard-deleted -- tickets_event_id_fkey
  // is NO ACTION, so the delete would just fail with a foreign key
  // violation. Cancel it instead (status flip + notify every ticket holder
  // via the same RPC CreateEventScreen's Cancel Event button uses); only an
  // event with zero tickets sold is actually removed.
  const handleDelete = async (ev) => {
    if (ev.sold > 0) {
      if (!window.confirm(`Cancel "${ev.title}"? Everyone with a ticket will be notified. This can't be undone.`)) return;
      setDeleting(s => ({ ...s, [ev.id]: true }));
      const { error } = await supabase.from('events').update({ status: 'cancelled' }).eq('id', ev.id);
      if (error) {
        console.error('[event-manager] failed to cancel event:', error);
        showToast('Could not cancel event: ' + error.message);
        setDeleting(s => { const n = { ...s }; delete n[ev.id]; return n; });
        return;
      }
      const { error: notifErr } = await supabase.rpc('notify_event_change', { p_event_id: ev.id, p_change_type: 'cancelled' });
      if (notifErr) console.error('[event-manager] cancel notify failed:', notifErr);
      setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, status: 'cancelled' } : e));
      setDeleting(s => { const n = { ...s }; delete n[ev.id]; return n; });
      showToast('Event cancelled');
      return;
    }
    if (!window.confirm(`Delete "${ev.title}"? This cannot be undone.`)) return;
    setDeleting(s => ({ ...s, [ev.id]: true }));
    const { error } = await supabase.from('events').delete().eq('id', ev.id);
    if (error) {
      console.error('[event-manager] failed to delete event:', error);
      showToast('Could not delete event: ' + error.message);
      setDeleting(s => { const n = { ...s }; delete n[ev.id]; return n; });
      return;
    }
    setEvents(prev => prev.filter(e => e.id !== ev.id));
    setDeleting(s => { const n = { ...s }; delete n[ev.id]; return n; });
  };

  const STATUS = {
    live:      { bg:'#E4F7EC', color:'#15A34A', text:'● Live'   },
    draft:     { bg:'#FFF6EC', color:'#F59E0B', text:'Draft'    },
    past:      { bg:'#F1F3F7', color:'#7B8499', text:'Ended'    },
    cancelled: { bg:'#FFF1ED', color:C.danger,  text:'Cancelled' },
  };
  const EMPTY_WORD = { live:'live', draft:'draft', past:'past', cancelled:'cancelled' };

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      {/* Header */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)',
                    backdropFilter:'blur(16px)', padding:'52px 14px 12px',
                    display:'flex', alignItems:'center', gap:8,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', zIndex:4 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none',
          borderRadius:13, background:C.chip, display:'flex', alignItems:'center',
          justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:19, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Manage Events</div>
        <button onClick={() => navigate('create-event')} style={{ width:40, height:40,
          border:'none', borderRadius:13,
          background:'linear-gradient(135deg,#19BFFF,#008FF0)',
          display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
          flexShrink:0, boxShadow:'0 4px 10px rgba(2,162,240,0.32)' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Summary band */}
      <div style={{ flexShrink:0, padding:'14px 16px 0' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
          {[{v:fmtMoney(totals.revenue),label:'Ticket revenue'},{v:fmtCount(totals.rsvps),label:'Total RSVPs'},{v:fmtCount(totals.likes),label:'Total likes'}].map(s => (
            <div key={s.label} style={{ background:'#fff', borderRadius:16,
                                         boxShadow:'0 4px 14px rgba(16,24,40,0.05)',
                                         padding:'13px 8px', textAlign:'center' }}>
              <div style={{ fontSize:19, fontWeight:800, color:C.ink,
                            letterSpacing:-0.5 }}>{s.v}</div>
              <div style={{ fontSize:12.5, fontWeight:600, color:C.subtle,
                            marginTop:2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ flexShrink:0, padding:'14px 16px 4px', display:'flex', gap:8 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex:1, height:38, border:'none', borderRadius:11, cursor:'pointer',
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            fontSize:15, fontWeight:700, textTransform:'capitalize',
            background: t===tab ? C.primary : '#fff',
            color: t===tab ? '#fff' : C.muted,
            boxShadow: t===tab ? '0 4px 12px rgba(2,162,240,0.3)' : '0 2px 8px rgba(16,24,40,0.04)',
          }}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
        ))}
      </div>

      {/* Event list */}
      <div style={{ flex:1, overflowY:'auto', padding:'10px 16px 30px',
                    display:'flex', flexDirection:'column', gap:14 }}>

        {loading && (
          <div style={{ textAlign:'center', padding:'50px 30px', color:C.subtle, fontSize:15, fontWeight:600 }}>
            Loading your events…
          </div>
        )}

        {!loading && list.length === 0 && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                        textAlign:'center', padding:'50px 30px' }}>
            <div style={{ width:74, height:74, borderRadius:22, background:'#EAF1F8',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="#9AB4CC" strokeWidth="1.8"/>
                <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="#9AB4CC" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ fontSize:18, fontWeight:800, color:C.ink, marginTop:18 }}>
              No {EMPTY_WORD[tab]} events
            </div>
            <div style={{ fontSize:15, color:C.subtle, marginTop:6, maxWidth:230 }}>
              Create an event to start selling tickets and tracking attendance.
            </div>
          </div>
        )}

        {!loading && list.map(e => {
          const sm = STATUS[tab];
          const cap = e.capacity > 0 ? e.capacity : 0;
          const pct = cap > 0 ? Math.round((e.sold / cap) * 100) : 0;
          const { isFree, amount } = parseEventPrice(e.price);
          const salesLabel = isFree ? 'Free' : `$${(amount * e.sold).toLocaleString()}`;
          const d = new Date(e.full_date || e.date || '');
          const day = !isNaN(d) ? String(d.getDate()).padStart(2, '0') : '—';
          const mon = !isNaN(d) ? d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase() : 'TBD';
          const when = !isNaN(d)
            ? fmtDate(e.full_date || e.date) + (e.start_time ? ` · ${e.start_time}` : '')
            : 'Not scheduled';
          return (
            <div key={e.id} style={{ background:'#fff', borderRadius:20,
                                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)',
                                      overflow:'hidden' }}>
              {/* Top */}
              <div style={{ display:'flex', gap:13, padding:14 }}>
                <div style={{ width:64, height:64, borderRadius:15, flexShrink:0,
                              background:e.grad, position:'relative', overflow:'hidden',
                              display:'flex', flexDirection:'column', alignItems:'center',
                              justifyContent:'center', color:'#fff' }}>
                  <div style={{ position:'absolute', inset:0, background:
                    'repeating-linear-gradient(135deg,rgba(255,255,255,0.14) 0,rgba(255,255,255,0.14) 2px,transparent 2px,transparent 9px)'}}/>
                  <span style={{ position:'relative', fontSize:21, fontWeight:800, lineHeight:1 }}>
                    {day}
                  </span>
                  <span style={{ position:'relative', fontSize:12, fontWeight:700,
                                 letterSpacing:0.5, marginTop:2 }}>{mon}</span>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                    <span style={{ display:'inline-flex', alignItems:'center', height:22,
                                   padding:'0 10px', borderRadius:999, fontSize:13,
                                   fontWeight:800, background:sm.bg, color:sm.color }}>
                      {sm.text}
                    </span>
                  </div>
                  <div style={{ fontSize:16.5, fontWeight:800, color:C.ink,
                                marginTop:5, lineHeight:1.2 }}>{e.title}</div>
                  <div style={{ fontSize:14, color:C.subtle, marginTop:3 }}>{when}</div>
                </div>
              </div>

              {/* Metrics */}
              {cap > 0 && (
                <div style={{ padding:'0 14px 10px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between',
                                marginBottom:5 }}>
                    <span style={{ fontSize:13, fontWeight:700, color:C.subtle }}>
                      {e.sold}/{cap} tickets
                    </span>
                    <span style={{ fontSize:13, fontWeight:700, color:C.primary }}>
                      {pct}%
                    </span>
                  </div>
                  <div style={{ height:5, borderRadius:999, background:'#EAEDF2',
                                overflow:'hidden' }}>
                    <div style={{ height:'100%', borderRadius:999,
                                  width:`${pct}%`,
                                  background:'linear-gradient(90deg,#19BFFF,#0098F0)' }}/>
                  </div>
                </div>
              )}

              {/* Stats row */}
              <div style={{ display:'flex', gap:0, padding:'0 14px 10px' }}>
                {[{l:'Sales',v:salesLabel},{l:'RSVPs',v:String(e.sold)},{l:'Likes',v:String(e.likeCount)}].map((s,i) => (
                  <div key={s.l} style={{ flex:1, textAlign:'center',
                                          borderRight: i<2 ? `1px solid ${C.divider}` : 'none',
                                          padding:'4px 0' }}>
                    <div style={{ fontSize:15.5, fontWeight:800, color:C.ink }}>{s.v}</div>
                    <div style={{ fontSize:12, fontWeight:600, color:C.subtle,
                                  marginTop:1 }}>{s.l}</div>
                  </div>
                ))}
              </div>

              {/* Action row */}
              <div style={{ display:'flex', gap:9, padding:'0 14px 14px' }}>
                {tab === 'live' && (
                  <button onClick={() => navigate('check-in', {eventId: e.id})} style={{
                    flex:1, height:40, border:'none', borderRadius:12,
                    background:'#E9F6FF', color:C.primary,
                    fontSize:14.5, fontWeight:800, cursor:'pointer',
                    fontFamily:"'Montserrat',-apple-system,sans-serif",
                    display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16"
                            stroke={C.primary} strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    Check-in
                  </button>
                )}
                <button onClick={() => navigate('create-event', { eventId: e.id })} style={{
                  flex:1, height:40, border:'none', borderRadius:12,
                  background:'#F1F3F7', color:C.muted,
                  fontSize:14.5, fontWeight:800, cursor:'pointer',
                  fontFamily:"'Montserrat',-apple-system,sans-serif",
                  display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M5 19h3l9-9-3-3-9 9v3Z" stroke={C.muted} strokeWidth="1.9"
                          strokeLinejoin="round"/>
                  </svg>
                  Edit
                </button>
                <button onClick={() => handleDelete(e)} style={{
                  width:40, height:40, border:'none', borderRadius:12, flexShrink:0,
                  background:'#FFF1ED', display:'flex', alignItems:'center',
                  justifyContent:'center', cursor:'pointer',
                }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                    <path d="M5 7h14M9 7V5h6v2M6 7l1 13h10l1-13"
                          stroke={C.danger} strokeWidth="1.9" strokeLinecap="round"
                          strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: WEEKLY DIGEST
// ─────────────────────────────────────────────────────────────
function WeeklyDigestScreen({ goBack, navigate, showToast }) {
  const PICKS = [
    { title:'Founders Networking Mixer', when:'Tue · 6:00 PM · Innovation Lab',
      reason:'BASED ON YOUR INTERESTS', reasonColor:'#2F6BFF', reasonBg:'#EAF1FF',
      grad:'linear-gradient(135deg,#2F6BFF,#6C4DF2)', eventId:5 },
    { title:'Intro to AI Workshop',      when:'Thu · 4:30 PM · Engineering Hall',
      reason:'MATCHES YOUR PROGRAM',   reasonColor:'#7C5CFF', reasonBg:'#F1ECFF',
      grad:'linear-gradient(135deg,#7C5CFF,#B06BFF)', eventId:2 },
    { title:'3v3 Basketball Tournament', when:'Sat · 1:00 PM · Rec Center',
      reason:'YOUR FRIENDS ARE GOING', reasonColor:'#15A34A', reasonBg:'#E4F7EC',
      grad:'linear-gradient(135deg,#10B981,#06B6D4)', eventId:4 },
  ];
  const TRENDING = [
    { title:'Winter Campus Festival',  rsvps:'2,100', eventId:6 },
    { title:'Spring Career Fair 2026', rsvps:'1,280', eventId:3 },
    { title:'Karaoke Night',           rsvps:'540',   eventId:1 },
  ];

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      {/* Header */}
      <div style={{ flexShrink:0, background:'rgba(255,255,255,0.96)',
                    backdropFilter:'blur(16px)', padding:'52px 14px 12px',
                    display:'flex', alignItems:'center', gap:8,
                    boxShadow:'0 1px 0 rgba(16,24,40,0.07)', zIndex:4 }}>
        <button onClick={goBack} style={{ width:40, height:40, border:'none',
          borderRadius:13, background:C.chip, display:'flex', alignItems:'center',
          justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#39414F" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{ flex:1, textAlign:'center', fontSize:18, fontWeight:800,
                      color:C.ink }}>Your Weekly Digest</div>
        <button onClick={() => showToast('Link copied')} style={{ width:40, height:40,
          border:'none', borderRadius:13, background:C.chip,
          display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <circle cx="18" cy="5" r="3" stroke="#39414F" strokeWidth="1.8"/>
            <circle cx="6" cy="12" r="3" stroke="#39414F" strokeWidth="1.8"/>
            <circle cx="18" cy="19" r="3" stroke="#39414F" strokeWidth="1.8"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" stroke="#39414F" strokeWidth="1.8"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" stroke="#39414F" strokeWidth="1.8"/>
          </svg>
        </button>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'0 0 30px' }}>

        {/* Hero */}
        <div style={{ position:'relative', overflow:'hidden',
                      background:'linear-gradient(160deg,#0E84E0,#19BFFF 60%,#2FD2D2)',
                      padding:'26px 22px 30px' }}>
          <div style={{ position:'absolute', inset:0, background:
            'repeating-linear-gradient(135deg,rgba(255,255,255,0.06) 0,rgba(255,255,255,0.06) 2px,transparent 2px,transparent 20px)'}}/>
          <div style={{ position:'absolute', width:180, height:180, borderRadius:'50%',
                        background:'rgba(255,255,255,0.1)', top:-60, right:-50 }}/>
          <div style={{ position:'relative', display:'flex', alignItems:'center', gap:9 }}>
            <RiplyMark size={26} white />
            <span style={{ fontSize:14, fontWeight:800, letterSpacing:1,
                           color:'rgba(255,255,255,0.9)' }}>RIPLY · WEEKLY</span>
          </div>
          <div style={{ position:'relative', fontSize:25, fontWeight:800, letterSpacing:-0.5,
                        color:'#fff', marginTop:16, lineHeight:1.2 }}>
            Hey Jane — here's what's happening on campus this week 👋
          </div>
          <div style={{ position:'relative', fontSize:15, color:'rgba(255,255,255,0.85)',
                        marginTop:8 }}>
            Jun 21 – Jun 27 · Personalized for you
          </div>
        </div>

        {/* Stats card */}
        <div style={{ margin:'-16px 16px 0', background:'#fff', borderRadius:20,
                      padding:16, boxShadow:'0 6px 18px rgba(16,24,40,0.08)',
                      position:'relative' }}>
          <div style={{ fontSize:15, fontWeight:800, color:C.ink, marginBottom:12 }}>
            Your week at a glance
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
            {[
              { v:'3', label:'Events attended', color:C.primary },
              { v:'2', label:'Groups active',   color:'#7C5CFF' },
              { v:'12',label:'New connections', color:'#15A34A' },
            ].map((s, i) => (
              <div key={i} style={{ textAlign:'center',
                                    borderLeft: i>0 ? `1px solid ${C.divider}` : 'none',
                                    paddingLeft: i>0 ? 8 : 0 }}>
                <div style={{ fontSize:24, fontWeight:800, color:s.color,
                              letterSpacing:-0.5 }}>{s.v}</div>
                <div style={{ fontSize:12.5, fontWeight:600, color:C.subtle,
                              marginTop:2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Picked for you */}
        <div style={{ padding:'22px 16px 0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:13 }}>
            <div style={{ width:26, height:26, borderRadius:8, background:'#F1ECFF',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"
                      stroke="#7C5CFF" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <span style={{ fontSize:18, fontWeight:800, color:C.ink }}>Picked for you</span>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {PICKS.map((p, i) => (
              <div key={i} onClick={() => navigate('event-details', {eventId: p.eventId})}
                style={{ display:'flex', gap:13, background:'#fff', borderRadius:18,
                         padding:12, boxShadow:'0 4px 14px rgba(16,24,40,0.05)',
                         cursor:'pointer' }}>
                <div style={{ width:66, height:66, borderRadius:14, flexShrink:0,
                              background:p.grad, position:'relative', overflow:'hidden' }}>
                  <div style={{ position:'absolute', inset:0, background:
                    'repeating-linear-gradient(135deg,rgba(255,255,255,0.14) 0,rgba(255,255,255,0.14) 2px,transparent 2px,transparent 9px)'}}/>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <span style={{ display:'inline-block', fontSize:12, fontWeight:800,
                                 letterSpacing:0.4, color:p.reasonColor,
                                 background:p.reasonBg, padding:'3px 8px',
                                 borderRadius:6 }}>{p.reason}</span>
                  <div style={{ fontSize:16.5, fontWeight:800, color:C.ink, marginTop:5,
                                lineHeight:1.2 }}>{p.title}</div>
                  <div style={{ fontSize:14, fontWeight:600, color:C.primary,
                                marginTop:4 }}>{p.when}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Trending */}
        <div style={{ padding:'22px 16px 0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:13 }}>
            <div style={{ width:26, height:26, borderRadius:8, background:'#FFF6EC',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="15" height="15" viewBox="0 0 24 24">
                <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l1-8Z"
                      fill="#FFB020" stroke="#F59E0B" strokeWidth="1.4" strokeLinejoin="round"/>
              </svg>
            </div>
            <span style={{ fontSize:18, fontWeight:800, color:C.ink }}>Trending this week</span>
          </div>
          <div style={{ background:'#fff', borderRadius:18, padding:'4px 16px',
                        boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
            {TRENDING.map((t, i) => (
              <div key={i} onClick={() => navigate('event-details', {eventId: t.eventId})}
                style={{ display:'flex', alignItems:'center', gap:13, padding:'13px 0',
                         borderBottom: i<TRENDING.length-1 ? `1px solid ${C.divider}` : 'none',
                         cursor:'pointer' }}>
                <span style={{ fontSize:19, fontWeight:800, color:'#D4D9E2', width:18 }}>
                  {i+1}
                </span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:16, fontWeight:700, color:C.ink,
                                whiteSpace:'nowrap', overflow:'hidden',
                                textOverflow:'ellipsis' }}>{t.title}</div>
                  <div style={{ fontSize:13.5, color:C.subtle,
                                marginTop:1 }}>{t.rsvps} going</div>
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="m9 6 6 6-6 6" stroke="#C5CBD6" strokeWidth="2.2"
                        strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            ))}
          </div>
        </div>

        {/* Group Spotlight */}
        <div style={{ padding:'22px 16px 0' }}>
          <div style={{ background:'linear-gradient(135deg,#0E1726,#243042)',
                        borderRadius:20, padding:20, position:'relative', overflow:'hidden' }}>
            <div style={{ position:'absolute', inset:0, background:
              'repeating-linear-gradient(135deg,rgba(255,255,255,0.03) 0,rgba(255,255,255,0.03) 2px,transparent 2px,transparent 16px)'}}/>
            <div style={{ position:'relative' }}>
              <div style={{ fontSize:13, fontWeight:800, letterSpacing:1,
                            color:'#19BFFF' }}>GROUP SPOTLIGHT</div>
              <div style={{ fontSize:20, fontWeight:800, color:'#fff',
                            marginTop:8 }}>Photography Collective</div>
              <div style={{ fontSize:14.5, lineHeight:1.5,
                            color:'rgba(255,255,255,0.7)', marginTop:6 }}>
                320 students sharing campus shots, weekly photo walks, and gear swaps.
                Spots are filling fast for the spring exhibition.
              </div>
              <button onClick={() => navigate('group-profile', {groupId: 4})} style={{
                display:'inline-flex', alignItems:'center', gap:7, marginTop:14,
                height:40, padding:'0 18px', border:'none', borderRadius:999,
                background:'#19BFFF', color:'#fff', fontSize:15, fontWeight:800,
                cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
              }}>Join the club</button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign:'center', padding:'26px 30px 0' }}>
          <div style={{ fontSize:14.5, color:C.subtle, lineHeight:1.5 }}>
            You're receiving this because you're part of campus life on Riply.
          </div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
                        gap:6, marginTop:8 }}>
            <span onClick={() => showToast('Digest settings')}
              style={{ fontSize:14.5, fontWeight:700, color:C.primary, cursor:'pointer' }}>
              Digest settings
            </span>
            <span style={{ color:C.divider }}>·</span>
            <span onClick={() => showToast('Unsubscribed from weekly digest')}
              style={{ fontSize:14.5, fontWeight:700, color:C.subtle, cursor:'pointer' }}>
              Unsubscribe
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// SCREEN: TICKETS  (purchase → processing → success | failed)
// ─────────────────────────────────────────────────────────────
// ── Stripe inner form ─────────────────────────────────────────
function StripePaymentForm({ total, onSuccess, onError }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setPaying(true);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    setPaying(false);
    if (error) { onError(error.message); } else { onSuccess(paymentIntent?.id || null); }
  };

  return (
    <form onSubmit={handleSubmit} style={{ width:'100%' }}>
      <PaymentElement options={{ layout: 'tabs' }} />
      <button type="submit" disabled={!stripe || paying} style={{
        width:'100%', height:52, marginTop:16, border:'none', borderRadius:16, cursor:'pointer',
        background: (!stripe||paying) ? '#C5CBD6' : 'linear-gradient(135deg,#19BFFF,#008FF0)',
        color:'#fff', fontSize:16, fontWeight:800,
        fontFamily:"'Montserrat',-apple-system,sans-serif",
        boxShadow: (!stripe||paying) ? 'none' : '0 8px 20px rgba(2,162,240,0.42)',
      }}>
        {paying ? 'Processing…' : `Pay $${total.toFixed(2)}`}
      </button>
    </form>
  );
}

function TicketsScreen({ eventId, goBack, navigate, showToast }) {
  const { user } = useUser();
  const { event: dbEvent, loading: eventLoading } = useEvent(eventId);
  // No mock fallback here — this screen writes real ticket rows and takes
  // real payments, so a failed/missing Supabase lookup must show the
  // not-found state below rather than silently checking out against fake
  // event data.
  const ev = dbEvent || null;

  const [step,          setStep]          = useState('purchase'); // purchase | stripe | processing | success | failed
  const [ticket,        setTicket]        = useState('general');
  const [qty,           setQty]           = useState(1);
  const [clientSecret,  setClientSecret]  = useState(null);
  const [stripeError,   setStripeError]   = useState(null);
  // Ref guard so a fast double-tap can't fire two concurrent purchases before
  // the `step` state update (which itself renders the button away) flushes.
  const proceedingRef = useRef(false);

  // ── LOADING / NOT FOUND ──────────────────────────────────────
  if (eventLoading) return (
    <div style={{ height:'100%', overflowY:'auto', background:C.pageBg }}>
      <Shimmer width="100%" height={260} radius={0} />
      <div style={{ padding:'18px 16px', display:'flex', flexDirection:'column', gap:10 }}>
        <Shimmer width="70%" height={22} />
        <Shimmer width="45%" height={14} />
        <Shimmer width="90%" height={14} style={{ marginTop:8 }} />
        <Shimmer width="80%" height={14} />
      </div>
    </div>
  );
  if (!ev) return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', alignItems:'center',
                  justifyContent:'center', gap:14, padding:24, textAlign:'center',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      <div style={{ fontSize:17, fontWeight:800, color:C.ink }}>Event not found</div>
      <button onClick={goBack} style={{ height:44, padding:'0 22px', border:'none', borderRadius:14,
        background:C.grad, color:'#fff', fontSize:15.5, fontWeight:800, cursor:'pointer',
        fontFamily:"'Montserrat',-apple-system,sans-serif" }}>Go Back</button>
    </div>
  );

  const { isFree: eventIsFree, amount: eventPrice } = parseEventPrice(ev.price);
  const FEE_PER   = 2.50;
  const TAX_RATE  = 0.05;

  // VIP costs a premium over the event's listed price; General pays that
  // listed price outright (previously General was hardcoded free, which let
  // anyone skip payment on a paid event by picking that tier).
  const VIP_MULTIPLIER = 1.5;
  const TICKET_TYPES = [
    { id:'general', name:'General Admission', desc:'Standing room · general access',     price: eventIsFree ? 0 : eventPrice },
    { id:'vip',     name:'VIP Experience',    desc:'Premium seating · backstage access', price: eventIsFree ? 0 : +(eventPrice * VIP_MULTIPLIER).toFixed(2) },
  ];

  // ── pricing helpers ─────────────────────────────────────────
  const isFree    = eventIsFree;
  const unitPrice = isFree ? 0 : (ticket === 'vip' ? eventPrice * VIP_MULTIPLIER : eventPrice);
  const subtotal  = unitPrice * qty;
  const fee       = isFree ? 0 : FEE_PER * qty;
  const tax       = isFree ? 0 : +((subtotal + fee) * TAX_RATE).toFixed(2);
  const total     = subtotal + fee + tax;
  const money     = (n) => '$' + n.toFixed(2);
  const totalLabel = isFree ? 'Free' : money(total);

  // ── save ticket to Supabase after success ──────────────────
  // Returns whether the save succeeded so proceedImpl can avoid showing a
  // false "confirmed" screen when the write actually failed.
  // `silent` lets the paid (Stripe) path show its own context-specific
  // message instead of stacking this generic one on top of it.
  const saveTicket = async (silent = false, paymentIntentId = null) => {
    if (!user?.id) return false;
    // Store an ISO date when the event's date field parses cleanly, so
    // MyTicketsScreen's ACTIVE/USED comparison doesn't depend on the
    // event's display-formatted string surviving a round trip through
    // `new Date(...)`. Falls back to the raw string if it doesn't parse.
    const rawDate = ev.fullDate || ev.full_date || ev.date;
    const parsedDate = rawDate ? new Date(rawDate) : null;
    const ticketDate = parsedDate && !isNaN(parsedDate) ? parsedDate.toISOString() : rawDate;
    try {
      const { data: newTicket, error } = await supabase.from('tickets').insert({
        user_id:      user.id,
        event_id:     ev.id,
        event_title:  ev.title,
        access:       ticket === 'vip' ? 'VIP Experience' : 'General Admission',
        status:       'ACTIVE',
        date:         ticketDate,
        time:         ev.timeRange || ev.time_range || ev.start_time || null,
        location:     ev.location,
        // Captured at purchase time (fee + tax included) rather than derived
        // later from the event's current price -- a since-changed event
        // price would otherwise make past purchases look wrong in history.
        amount_paid:  total,
        stripe_payment_intent_id: paymentIntentId,
      }).select('id').single();
      if (error) throw error;
      // Best-effort: the ticket itself already saved above, so a failure to
      // notify the organizer shouldn't affect the buyer's confirmation.
      // Scoped to this specific ticket id (not just the event) so the RPC
      // can enforce it only ever fires once per purchase.
      const { error: notifErr } = await supabase.rpc('notify_ticket_purchase', { p_ticket_id: newTicket.id });
      if (notifErr) console.error('[tickets] organizer notify failed:', notifErr);
      return true;
    } catch (err) {
      console.error('[tickets] save error:', err);
      if (!silent) showToast('Could not save your ticket. Please try again.');
      return false;
    }
  };

  // ── proceed → free RSVP or create Stripe PaymentIntent ─────
  const proceed = async () => {
    if (proceedingRef.current) return;
    proceedingRef.current = true;
    try {
      await proceedImpl();
    } finally {
      proceedingRef.current = false;
    }
  };
  const proceedImpl = async () => {
    if (isFree) {
      setStep('processing');
      const saved = await saveTicket();
      setStep(saved ? 'success' : 'purchase');
      return;
    }
    setStep('processing');
    try {
      const { data, error } = await supabase.functions.invoke('create-payment-intent', {
        body: { amount: total, currency: 'cad', metadata: { event_id: String(ev.id), user_id: user?.id || '' } },
      });
      if (error || !data?.client_secret) throw new Error(error?.message || 'Payment setup failed');
      setClientSecret(data.client_secret);
      setStep('stripe');
    } catch (err) {
      setStripeError(err.message);
      setStep('failed');
    }
  };

  // ── event gradient ──────────────────────────────────────────
  const th = THEME[ev.primary || ev.category] || THEME.social;

  // ── PROCESSING ──────────────────────────────────────────────
  if (step === 'processing') return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  alignItems:'center', justifyContent:'center', gap:22,
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      <div style={{ width:58, height:58, borderRadius:'50%',
                    border:`5px solid #E1E6EE`,
                    borderTopColor:C.primary,
                    animation:'riplySpin .9s linear infinite' }}/>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:19, fontWeight:800, color:C.ink }}>Processing payment…</div>
        <div style={{ fontSize:15, color:C.subtle, marginTop:6 }}>
          Please don't close this screen
        </div>
      </div>
      <style>{`@keyframes riplySpin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );

  // ── SUCCESS ─────────────────────────────────────────────────
  if (step === 'success') return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column',
                    alignItems:'center', padding:'70px 24px 20px' }}>
        {/* Check circle */}
        <div style={{ width:88, height:88, borderRadius:'50%', background:'#E4F7EC',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      animation:'riplyPop .5s cubic-bezier(.2,.8,.2,1)' }}>
          <div style={{ width:60, height:60, borderRadius:'50%',
                        background:'linear-gradient(135deg,#22C55E,#15A34A)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        boxShadow:'0 8px 20px rgba(21,163,74,0.4)' }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
              <path d="m5 12.5 4.5 4.5L19 7" stroke="#fff" strokeWidth="3"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
        <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.5,
                      color:C.ink, marginTop:20 }}>
          {isFree ? 'Spot reserved!' : 'Payment confirmed!'}
        </div>
        <div style={{ fontSize:15.5, lineHeight:1.55, color:'#7B8499',
                      textAlign:'center', marginTop:8, maxWidth:280 }}>
          {isFree
            ? 'Your spot is reserved. Your ticket is ready in My Tickets.'
            : `Your ticket for ${ev.title} is confirmed. See you there!`}
        </div>

        {/* Ticket summary card */}
        <div style={{ width:'100%', background:'#fff', borderRadius:20,
                      boxShadow:'0 6px 18px rgba(16,24,40,0.08)',
                      overflow:'hidden', marginTop:24 }}>
          <div style={{ height:5, background:th.grad }}/>
          <div style={{ padding:'14px 16px' }}>
            <div style={{ display:'flex', gap:12, alignItems:'center' }}>
              <div style={{ width:54, height:54, borderRadius:13, flexShrink:0,
                            background:th.grad, position:'relative', overflow:'hidden' }}>
                <div style={{ position:'absolute', inset:0, background:
                  'repeating-linear-gradient(135deg,rgba(255,255,255,0.14) 0,rgba(255,255,255,0.14) 2px,transparent 2px,transparent 9px)'}}/>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:18, fontWeight:800, color:C.ink }}>{ev.title}</div>
                <div style={{ fontSize:14, fontWeight:600, color:C.primary, marginTop:3 }}>
                  {fmtDate(ev.fullDate || ev.full_date || ev.date)}
                </div>
                <div style={{ fontSize:13.5, color:C.subtle, marginTop:1 }}>
                  {ev.venue} · {ev.room}
                </div>
              </div>
            </div>
            <div style={{ marginTop:14, paddingTop:14, borderTop:`1px dashed ${C.divider}`,
                          display:'flex', justifyContent:'space-between' }}>
              <div>
                <div style={{ fontSize:12.5, fontWeight:700, color:C.subtle,
                              textTransform:'uppercase', letterSpacing:0.3 }}>Ticket type</div>
                <div style={{ fontSize:15, fontWeight:700, color:C.body, marginTop:3 }}>
                  {ticket === 'vip' ? 'VIP Experience' : 'General Admission'} × {qty}
                </div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:12.5, fontWeight:700, color:C.subtle,
                              textTransform:'uppercase', letterSpacing:0.3 }}>Total paid</div>
                <div style={{ fontSize:17, fontWeight:800, color:C.ink, marginTop:3 }}>
                  {totalLabel}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ width:'100%', display:'flex', gap:10, marginTop:18 }}>
          <button onClick={() => showToast('Added to your calendar')} style={{
            flex:1, height:46, border:`1.5px solid ${C.border}`, borderRadius:14,
            background:'#fff', fontSize:15, fontWeight:700, color:C.body,
            cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke={C.muted} strokeWidth="1.9"/>
              <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={C.muted} strokeWidth="1.9" strokeLinecap="round"/>
            </svg>
            Calendar
          </button>
          <button onClick={() => navigate('my-tickets')} style={{
            flex:1, height:46, border:'none', borderRadius:14,
            background:C.grad, fontSize:15, fontWeight:800, color:'#fff',
            cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
            boxShadow:'0 6px 16px rgba(2,162,240,0.32)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M4 8.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 1.8 1.8 0 0 0 0 3.4A1.8 1.8 0 0 0 20 15.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 1.8 1.8 0 0 0 0-3.6A1.8 1.8 0 0 0 4 8.5Z"
                    stroke="#fff" strokeWidth="1.8" strokeLinejoin="round"/>
              <path d="M14 7.5v9" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="0.5 3"/>
            </svg>
            View Ticket
          </button>
        </div>
        <button onClick={goBack} style={{ border:'none', background:'none', cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          fontSize:15.5, fontWeight:700, color:C.primary, marginTop:16 }}>
          Back to event
        </button>
        <style>{`@keyframes riplyPop{0%{transform:scale(0.6);opacity:0;}60%{transform:scale(1.08);}100%{transform:scale(1);opacity:1;}}`}</style>
      </div>
    </div>
  );

  // ── FAILED ──────────────────────────────────────────────────
  if (step === 'failed') return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column',
                    alignItems:'center', padding:'70px 24px 20px' }}>
        <div style={{ width:88, height:88, borderRadius:'50%', background:'#FDE7E4',
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ width:60, height:60, borderRadius:'50%',
                        background:'linear-gradient(135deg,#F4452B,#C73B1E)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        boxShadow:'0 8px 20px rgba(244,69,43,0.4)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          </div>
        </div>
        <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.5,
                      color:C.ink, marginTop:20 }}>Payment failed</div>
        <div style={{ fontSize:15.5, lineHeight:1.55, color:'#7B8499',
                      textAlign:'center', marginTop:8, maxWidth:280 }}>
          {stripeError || `We couldn't process your payment of `}
          {!stripeError && <><span style={{ fontWeight:700, color:C.ink }}>{money(total)}</span>. Please try again.</>}
        </div>
        <div style={{ width:'100%', background:'#fff', borderRadius:16,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.06)',
                      padding:16, marginTop:24 }}>
          <div style={{ fontSize:15, fontWeight:800, color:C.ink, marginBottom:12 }}>
            This can happen because of:
          </div>
          {['Insufficient funds','Incorrect card details or expired card',
            'Bank security restrictions'].map((r,i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10,
                                   marginBottom: i<2 ? 10 : 0 }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:'#9AA3B2',
                             flexShrink:0 }}/>
              <span style={{ fontSize:15, color:'#5B6473' }}>{r}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flexShrink:0, padding:'8px 20px 30px',
                    display:'flex', flexDirection:'column', gap:11 }}>
        <button onClick={proceed} style={{
          width:'100%', height:52, border:'none', borderRadius:16,
          background:C.grad, color:'#fff', fontSize:18, fontWeight:800,
          cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
          boxShadow:'0 8px 20px rgba(2,162,240,0.4)',
        }}>Try Again</button>
        <button onClick={() => showToast('Update your payment method in Settings')} style={{
          width:'100%', height:52, border:`1.5px solid ${C.primary}`,
          borderRadius:16, background:'#fff', color:C.primary,
          fontSize:17, fontWeight:800, cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
        }}>Update Payment Method</button>
      </div>
    </div>
  );

  // ── STRIPE PAYMENT ELEMENT ──────────────────────────────────
  if (step === 'stripe' && clientSecret && stripePromise) return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background:C.pageBg,
                  fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      <div style={{ flexShrink:0, padding:'50px 16px 14px', display:'flex', alignItems:'center', gap:12 }}>
        <button onClick={() => setStep('purchase')} style={{ width:40, height:40, border:'none', borderRadius:13,
          background:C.chip, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M14 6l-6 6 6 6" stroke={C.body} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span style={{ fontSize:21, fontWeight:800, letterSpacing:-0.4, color:C.ink }}>Payment</span>
        <span style={{ marginLeft:'auto', fontSize:18, fontWeight:800, color:C.primary }}>{money(total)}</span>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'0 16px 40px' }}>
        <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme:'stripe' } }}>
          <StripePaymentForm
            total={total}
            onSuccess={async (paymentIntentId) => {
              // Payment already went through via Stripe at this point — unlike
              // the free path, we can't just send a failed save back to
              // 'purchase' without risking a second charge. Still show
              // success (the charge is real) but flag it if the ticket
              // record itself didn't save, since saveTicket already showed
              // its own generic toast which doesn't fit a completed payment.
              const saved = await saveTicket(true, paymentIntentId);
              if (!saved) showToast('Payment received, but we had trouble saving your ticket — contact support if it doesn\'t appear in My Tickets.');
              setStep('success');
            }}
            onError={(msg) => { setStripeError(msg); setStep('failed'); }}
          />
        </Elements>
      </div>
    </div>
  );

  // ── PURCHASE SHEET ──────────────────────────────────────────
  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column',
                  position:'relative', fontFamily:"'Montserrat',-apple-system,sans-serif",
                  overflow:'hidden' }}>

      {/* Dimmed event backdrop */}
      <div style={{ position:'absolute', inset:0, background:th.grad }}/>
      <div style={{ position:'absolute', inset:0, background:
        'repeating-linear-gradient(135deg,rgba(255,255,255,0.08) 0,rgba(255,255,255,0.08) 2px,transparent 2px,transparent 16px)'}}/>
      <div style={{ position:'absolute', inset:0,
                    background:'rgba(14,23,38,0.55)', backdropFilter:'blur(2px)' }}/>

      {/* Floating back + event title */}
      <div style={{ position:'absolute', top:52, left:14, right:14,
                    display:'flex', alignItems:'center', gap:10, zIndex:3 }}>
        <button onClick={goBack} style={{ width:38, height:38, border:'none',
          borderRadius:12, background:'rgba(255,255,255,0.18)', display:'flex',
          alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="#fff" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span style={{ flex:1, textAlign:'center', fontSize:17,
                       fontWeight:800, color:'#fff' }}>{ev.title}</span>
        <div style={{ width:38 }}/>
      </div>

      {/* Bottom sheet */}
      <div style={{ position:'absolute', left:0, right:0, bottom:0, zIndex:3,
                    background:'#F4F6FA', borderRadius:'28px 28px 0 0',
                    boxShadow:'0 -12px 40px rgba(0,0,0,0.3)',
                    maxHeight:'88%', display:'flex', flexDirection:'column' }}>

        {/* Drag handle */}
        <div style={{ flexShrink:0, display:'flex', flexDirection:'column',
                      alignItems:'center', paddingTop:10 }}>
          <div style={{ width:40, height:5, borderRadius:999, background:'#D4D9E2' }}/>
        </div>

        {/* Scrollable body */}
        <div style={{ flex:1, overflowY:'auto', padding:'14px 18px 0' }}>

          {/* Header row */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:24, fontWeight:800, letterSpacing:-0.5,
                           color:C.ink }}>Purchase Tickets</span>
            <button onClick={goBack} style={{ width:34, height:34, border:'none',
              borderRadius:'50%', background:'#E9ECF2', display:'flex',
              alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="#5B6473" strokeWidth="2.2"
                      strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {/* Event mini card */}
          <div style={{ display:'flex', alignItems:'center', gap:13, background:'#fff',
                        borderRadius:18, padding:12, marginTop:14,
                        boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
            <div style={{ width:62, height:62, borderRadius:14, flexShrink:0,
                          background:th.grad, position:'relative', overflow:'hidden',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              {ev.image_url
                ? <img src={ev.image_url} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>
                : <div style={{ position:'absolute', inset:0, background:
                    'repeating-linear-gradient(135deg,rgba(255,255,255,0.14) 0,rgba(255,255,255,0.14) 2px,transparent 2px,transparent 10px)'}}/>}
            </div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:17, fontWeight:600, color:C.ink,
                            letterSpacing:-0.2 }}>{ev.title}</div>
              <div style={{ fontSize:14.5, fontWeight:600, color:C.primary,
                            marginTop:4 }}>{fmtDate(ev.fullDate || ev.full_date || ev.date)}</div>
              <div style={{ fontSize:14, color:C.subtle, marginTop:2 }}>
                {ev.venue}
              </div>
            </div>
          </div>

          {/* Ticket types */}
          <div style={{ fontSize:18, fontWeight:800, color:C.ink, marginTop:20 }}>
            Select Ticket Type
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:11, marginTop:12 }}>
            {TICKET_TYPES.map(t => {
              const on = ticket === t.id;
              return (
                <button key={t.id} onClick={() => setTicket(t.id)} style={{
                  display:'flex', alignItems:'center', gap:12, width:'100%',
                  borderRadius:18, padding:16, cursor:'pointer',
                  fontFamily:"'Montserrat',-apple-system,sans-serif", textAlign:'left',
                  background: on ? '#EAF6FF' : '#fff',
                  border: on ? `2px solid ${C.primary}` : '2px solid #EDEFF3',
                  boxShadow: on ? '0 4px 14px rgba(2,162,240,0.12)' : 'none',
                }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:17.5, fontWeight:800, color:C.ink }}>{t.name}</div>
                    <div style={{ fontSize:14.5, color:C.subtle, marginTop:3 }}>{t.desc}</div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:11, flexShrink:0 }}>
                    <span style={{ fontSize:17, fontWeight:800,
                                   color: t.price === 0 ? C.primary : C.ink }}>
                      {t.price === 0 ? 'Free' : money(t.price)}
                    </span>
                    <div style={{ width:24, height:24, borderRadius:'50%', flexShrink:0,
                                  display:'flex', alignItems:'center', justifyContent:'center',
                                  background: on ? C.primary : '#fff',
                                  border: on ? 'none' : `2px solid #D4D9E2` }}>
                      {on && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                          <path d="m5 12.5 4.5 4.5L19 7" stroke="#fff" strokeWidth="3"
                                strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Quantity */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                        marginTop:20 }}>
            <span style={{ fontSize:18, fontWeight:800, color:C.ink }}>Quantity</span>
            <div style={{ display:'flex', alignItems:'center', gap:14 }}>
              <button onClick={() => setQty(q => Math.max(1, q-1))} style={{
                width:36, height:36, border:'none', borderRadius:'50%',
                background:'#E9ECF2', display:'flex', alignItems:'center',
                justifyContent:'center', cursor:'pointer',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M5 12h14" stroke="#39414F" strokeWidth="2.4" strokeLinecap="round"/>
                </svg>
              </button>
              <span style={{ fontSize:20, fontWeight:800, color:C.ink,
                             minWidth:22, textAlign:'center' }}>{qty}</span>
              <button onClick={() => setQty(q => Math.min(8, q+1))} style={{
                width:36, height:36, border:'none', borderRadius:'50%',
                background:C.primary, display:'flex', alignItems:'center',
                justifyContent:'center', cursor:'pointer',
                boxShadow:'0 4px 10px rgba(2,162,240,0.3)',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Price breakdown */}
          <div style={{ marginTop:18, paddingTop:16,
                        borderTop:`1px solid ${C.divider}`,
                        display:'flex', flexDirection:'column', gap:11 }}>
            {[
              { label:`Subtotal (${qty} ticket${qty>1?'s':''})`, val: isFree ? 'Free' : money(subtotal) },
              { label:'Service Fee', val: isFree ? '—' : money(fee) },
              { label:'Taxes',       val: isFree ? '—' : money(tax) },
            ].map(r => (
              <div key={r.label} style={{ display:'flex', alignItems:'center',
                                           justifyContent:'space-between' }}>
                <span style={{ fontSize:15.5, fontWeight:500, color:'#7B8499' }}>
                  {r.label}
                </span>
                <span style={{ fontSize:15.5, fontWeight:700, color:'#1A2233' }}>
                  {r.val}
                </span>
              </div>
            ))}
          </div>

          {/* Total */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                        marginTop:15, paddingTop:15, borderTop:`1px solid ${C.divider}` }}>
            <span style={{ fontSize:20, fontWeight:800, color:C.ink }}>Total</span>
            <span style={{ fontSize:22, fontWeight:800, color:C.primary }}>
              {totalLabel}
            </span>
          </div>
        </div>

        {/* Sticky CTA */}
        <div style={{ flexShrink:0, padding:'14px 18px 26px', background:'#F4F6FA' }}>
          <button onClick={proceed} style={{
            width:'100%', height:54, border:'none', borderRadius:16,
            background:C.grad, color:'#fff', fontSize:18, fontWeight:800,
            cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:9,
            boxShadow:'0 8px 20px rgba(2,162,240,0.4)',
          }}>
            {isFree ? 'Reserve Spot' : 'Proceed to Payment'}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h13M13 6l6 6-6 6" stroke="#fff" strokeWidth="2.2"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RiplyApp({ clerkTimedOut } = {}) {
  const currentUser = useCurrentUser();
  const notifs = useNotifications();
  const chatsData = useChats();
  const groupActivityData = useGroupActivity();

  // Font injection
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = "@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap');@keyframes riplyPulse{0%{transform:scale(.7);opacity:.9}70%{transform:scale(2.4);opacity:0}100%{opacity:0}}@keyframes pill-shimmer{0%{left:-40%}60%{left:130%}100%{left:130%}}@keyframes riplyShimmer{0%{background-position:100% 0}100%{background-position:0 0}}*::-webkit-scrollbar{display:none;}";
    document.head.appendChild(style);
    return () => { if(document.head.contains(style)) document.head.removeChild(style); };
  }, []);

  // Navigation stack
  const [navStack, setNavStack] = useState([{ screen: 'loading' }]);

  // Auth guard: once Clerk loads, route to the right place. If Clerk is
  // blocked/unusually slow, `clerkTimedOut` (from App.jsx) lets us stop
  // waiting on isLoaded/profileLoading — which would otherwise never resolve
  // — and fall through to the signed-out path instead of hanging on 'loading'.
  useEffect(() => {
    if (!clerkTimedOut && (!currentUser.isLoaded || currentUser.profileLoading)) return;
    const current = navStack[navStack.length - 1].screen;
    const authScreens = ['welcome', 'auth', 'loading'];
    if (currentUser.isAuthenticated && currentUser.profile) {
      if (authScreens.includes(current)) setNavStack([{ screen: 'home' }]);
    } else if (currentUser.isAuthenticated && !currentUser.profile && !currentUser.profileLoading && !currentUser.profileError) {
      // Signed in via Clerk but no completed users row (e.g. reopened the app
      // mid-onboarding, or verified in a previous session) — send them to
      // finish onboarding instead of leaving them stuck on 'loading'. Guarded
      // on !profileLoading too: clerkTimedOut can let this effect run before
      // the profile fetch resolves, and profile is null during that window
      // regardless of whether a row actually exists. Guarded on !profileError
      // so a transient fetch failure isn't mistaken for "never onboarded" —
      // that would risk routing an already-onboarded user back through
      // onboarding, which upserts and could stomp their real profile data.
      if (current !== 'auth') setNavStack([{ screen: 'auth', initialStep: 'onboard' }]);
    } else if (!currentUser.isAuthenticated) {
      if (!authScreens.includes(current)) setNavStack([{ screen: 'welcome' }]);
      else if (current === 'loading') setNavStack([{ screen: 'welcome' }]);
    }
  }, [currentUser.isLoaded, currentUser.profileLoading, currentUser.isAuthenticated, currentUser.profile, clerkTimedOut]);

  const current = navStack[navStack.length - 1];
  const screen = current.screen;
  const navParams = current;

  const navigate = useCallback((scr, params = {}) => {
    setNavStack(s => [...s, { screen: scr, ...params }]);
  }, []);

  const goBack = useCallback(() => {
    setNavStack(s => s.length > 1 ? s.slice(0, -1) : s);
  }, []);

  // setScreen for bottom nav (reset to root tab)
  const setScreen = useCallback((scr, params = {}) => {
    setNavStack([{ screen: scr, ...params }]);
  }, []);

  const [toast, setToast] = useState(null);
  const toastRef = useRef(null);

  const showToast = useCallback((msg) => {
    clearTimeout(toastRef.current);
    setToast(msg);
    toastRef.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // Home state
  const { liked, saved, spaceSaved, shared, postLiked, toggleLike, toggleSave, toggleSaveSpace, recordShare, togglePostLike } = useUserInteractions();
  const [filters, setFilters] = useState({});
  const [activeCat, setActiveCat] = useState('all');
  const [query, setQuery] = useState('');
  // The real, persisted role lives on the user's own profile (changed via
  // Settings, which writes it to the database) -- this screen must read it,
  // not maintain its own separate copy that resets to 'student' every
  // session and can be flipped locally with no relationship to what the
  // user actually saved.
  const role = currentUser.role;

  // Spaces state
  const [spaceTab, setSpaceTab] = useState('all');
  const [spaceJoined, setSpaceJoined] = useState({});
  const [spaceNotify, setSpaceNotify] = useState({});
  const [progress, setProgress] = useState({ 2:24, 4:8 });

  // Discover state
  const [discoverTab, setDiscoverTab] = useState('all');
  const [groupJoined, setGroupJoined] = useState({});

  // Load persisted group + space joins from Supabase on login
  useEffect(() => {
    const uid = currentUser?.userId;
    if (!uid) return;
    Promise.all([
      supabase.from('group_members').select('group_id').eq('user_id', uid),
      supabase.from('space_participants').select('space_id').eq('user_id', uid),
    ]).then(([groups, spaces]) => {
      if (groups.data) setGroupJoined(Object.fromEntries(groups.data.map(r => [r.group_id, true])));
      if (spaces.data) setSpaceJoined(Object.fromEntries(spaces.data.map(r => [r.space_id, true])));
    });
  }, [currentUser?.userId]);

  // Messages state
  const [msgTab, setMsgTab] = useState('notifications');

  // Progress animation for Spaces
  useEffect(() => {
    if(screen!=='spaces') return;
    const timer = setInterval(() => {
      setProgress(p => {
        const np = {...p};
        let changed = false;
        SPACES.forEach(sp => {
          if(sp.started) {
            const cur = np[sp.id]??0;
            if(cur<100){np[sp.id]=Math.min(100,cur+1);changed=true;}
          }
        });
        return changed ? np : p;
      });
    }, 600);
    return () => clearInterval(timer);
  }, [screen]);

  const ROOT_SCREENS = ['home','spaces','discover','messages','profile'];
  const showBottomNav = ROOT_SCREENS.includes(screen);

  const renderScreen = () => {
    switch(screen) {
      case 'loading':   return <div style={{ width:'100%', height:'100%', background:C.pageBg }} />;
      case 'welcome':   return <WelcomeScreen navigate={navigate} setScreen={setScreen} />;
      case 'auth':      return <AuthScreen setScreen={setScreen} showToast={showToast} initialStep={navParams.initialStep} initialRole={navParams.role} currentUser={currentUser} />;
      case 'home':      return <HomeScreen liked={liked} toggleLike={toggleLike} saved={saved} toggleSave={toggleSave} shared={shared} recordShare={recordShare} filters={filters} setFilters={setFilters} activeCat={activeCat} setActiveCat={setActiveCat} query={query} setQuery={setQuery} role={role} navigate={navigate} />;
      case 'spaces':    return <SpacesScreen spaceTab={spaceTab} setSpaceTab={setSpaceTab} spaceJoined={spaceJoined} setSpaceJoined={setSpaceJoined} spaceNotify={spaceNotify} setSpaceNotify={setSpaceNotify} progress={progress} navigate={navigate} showToast={showToast} currentUser={currentUser} />;
      case 'discover':  return <DiscoverScreen discoverTab={discoverTab} setDiscoverTab={setDiscoverTab} groupJoined={groupJoined} setGroupJoined={setGroupJoined} navigate={navigate} showToast={showToast} />;
      case 'messages':  return <MessagesScreen msgTab={msgTab} setMsgTab={setMsgTab} navigate={navigate} showToast={showToast} notifs={notifs} chatsData={chatsData} groupActivityData={groupActivityData} />;
      case 'profile':   return <ProfileScreen navigate={navigate} showToast={showToast} currentUser={currentUser} saved={saved} />;
      case 'saved-events': return <SavedEventsScreen goBack={goBack} navigate={navigate} saved={saved} spaceSaved={spaceSaved} />;
      case 'create-event': return <CreateEventScreen goBack={goBack} navigate={navigate} showToast={showToast} currentUser={currentUser} groupId={navParams.groupId} eventId={navParams.eventId} />;
      case 'my-tickets':   return <MyTicketsScreen goBack={goBack} navigate={navigate} showToast={showToast} setScreen={setScreen} />;
      case 'create-space':  return <CreateSpaceScreen goBack={goBack} navigate={navigate} showToast={showToast} currentUser={currentUser} />;
      case 'create-group':  return <CreateGroupScreen goBack={goBack} navigate={navigate} showToast={showToast} currentUser={currentUser} />;
      case 'creation-success': return <CreationSuccessScreen kind={navParams.kind} id={navParams.id} title={navParams.title} navigate={navigate} setScreen={setScreen} />;
      case 'chat':          return <ChatScreen chatId={navParams.chatId} chatName={navParams.chatName} chatInitial={navParams.chatInitial} chatColor={navParams.chatColor} chatAvatarUrl={navParams.chatAvatarUrl} isGroup={navParams.isGroup} goBack={goBack} showToast={showToast} currentUser={currentUser} />;
      case 'event-details': return <EventDetailsScreen key={navParams.eventId} eventId={navParams.eventId} liked={liked} toggleLike={toggleLike} saved={saved} toggleSave={toggleSave} shared={shared} recordShare={recordShare} navigate={navigate} goBack={goBack} showToast={showToast} role={role} />;
      case 'space-details': return <SpaceDetailsScreen spaceId={navParams.spaceId} goBack={goBack} navigate={navigate} showToast={showToast} spaceSaved={spaceSaved} toggleSaveSpace={toggleSaveSpace} currentUser={currentUser} />;
      case 'group-profile':  return <GroupProfileScreen groupId={navParams.groupId} postLiked={postLiked} togglePostLike={togglePostLike} goBack={goBack} navigate={navigate} showToast={showToast} currentUser={currentUser} markGroupRead={groupActivityData.markGroupRead} />;
      case 'filters':       return <FiltersScreen from={navParams.from} filters={navParams.filters} setFilters={navParams.setFilters} goBack={goBack} showToast={showToast} />;
      case 'create-post':   return <CreatePostScreen goBack={goBack} groupId={navParams.groupId} showToast={showToast} />;
      case 'help-center':   return <HelpCenterScreen goBack={goBack} navigate={navigate} showToast={showToast} />;
      case 'feedback':      return <FeedbackScreen goBack={goBack} showToast={showToast} />;
      case 'legal':         return <LegalScreen goBack={goBack} showToast={showToast} />;
      case 'about':         return <AboutScreen goBack={goBack} navigate={navigate} showToast={showToast} />;
      case 'check-in':      return <CheckInScreen eventId={navParams.eventId} goBack={goBack} showToast={showToast} />;
      case 'review':        return <ReviewScreen ticketId={navParams.ticketId} goBack={goBack} navigate={navigate} showToast={showToast} />;
      case 'tickets':       return <TicketsScreen eventId={navParams.eventId} goBack={goBack} navigate={navigate} showToast={showToast} />;
      case 'group-manage':  return <GroupManageScreen groupId={navParams.groupId} goBack={goBack} navigate={navigate} showToast={showToast} currentUser={currentUser} />;
      case 'pending-requests': return <PendingRequestsScreen groupId={navParams.groupId} goBack={goBack} showToast={showToast} />;
      case 'banned-members':   return <BannedMembersScreen groupId={navParams.groupId} goBack={goBack} showToast={showToast} />;
      case 'review-reports':   return <ReviewReportsScreen groupId={navParams.groupId} goBack={goBack} showToast={showToast} />;
      case 'group-analytics':  return <GroupAnalyticsScreen groupId={navParams.groupId} goBack={goBack} showToast={showToast} currentUser={currentUser} />;
      case 'group-edit':       return <GroupEditScreen key={navParams.groupId} groupId={navParams.groupId} editTab={navParams.editTab} goBack={goBack} showToast={showToast} currentUser={currentUser} />;
      case 'event-manager': return <EventManagerScreen goBack={goBack} navigate={navigate} showToast={showToast} currentUser={currentUser} />;
      case 'weekly-digest': return <WeeklyDigestScreen goBack={goBack} navigate={navigate} showToast={showToast} />;
      default:          return <HomeScreen liked={liked} toggleLike={toggleLike} saved={saved} toggleSave={toggleSave} filters={filters} setFilters={setFilters} activeCat={activeCat} setActiveCat={setActiveCat} query={query} setQuery={setQuery} role={role} navigate={navigate} />;
    }
  };

  return (
    <div style={{ width:'100%', height:'100vh', position:'relative', background:C.pageBg,
                  fontFamily:"'Montserrat',-apple-system,sans-serif", overflow:'hidden' }}>
      <div style={{ height:'100%' }}>
        {renderScreen()}
      </div>
      {toast && <Toast msg={toast} />}
      {showBottomNav && <BottomNav screen={screen} setScreen={setScreen} unreadCount={chatsData.unreadChatCount} />}
    </div>
  );
}
