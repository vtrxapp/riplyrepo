import { useState, useEffect, useRef, useCallback } from "react";
import { useSignIn, useSignUp, useUser } from "@clerk/clerk-react";
import { useClerkAuth } from "./hooks/useClerkAuth";
import { useCurrentUser } from "./hooks/useCurrentUser";
import { useNotifications } from "./hooks/useNotifications";
import { useChat } from "./hooks/useChat";
import { useChats } from "./hooks/useChats";
import { useEvents } from "./hooks/useEvents";
import { useUserInteractions } from "./hooks/useUserInteractions";
import { usePosts } from "./hooks/usePosts";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;
import { useGroups } from "./hooks/useGroups";
import { useSpaces } from "./hooks/useSpaces";
import { uploadImage } from "./hooks/useUpload";
import { supabase } from "./lib/supabase";

// ─────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────
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
function RiplyMark({ size = 32, white = false }) {
  return (
    <img
      src="/logo.png"
      alt="Riply"
      width={size}
      height={size}
      style={{
        objectFit: 'contain',
        display: 'block',
        filter: white ? 'brightness(0) invert(1)' : 'none',
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

const NOTIFICATIONS = [
  { id:1, title:'UofM Economics Society', body:'Capture the beauty of campus life and improve your photography skills.', time:'2h', initial:'E', color:'linear-gradient(135deg,#0E1726,#3A4252)', hasAlert:true, alertCount:5, alertText:'Mike: The new mockups are ready for the pre…' },
  { id:2, title:'Career Center', body:'Spring Career Fair starts in 2 days — 80+ employers confirmed. Tap to RSVP.', time:'5h', initial:'C', color:'linear-gradient(135deg,#19BFFF,#0078E0)', hasAlert:false },
  { id:3, title:'VW Social Club', body:'Karaoke Night is tonight at 8PM. Your spot is saved — see you there!', time:'1d', initial:'V', color:'linear-gradient(135deg,#FF5A8A,#FF8A3D)', hasAlert:false },
  { id:4, title:'Rec Sports', body:'A spot just opened in Seasonal Basketball 5v5. Grab it before it fills up.', time:'2d', initial:'R', color:'linear-gradient(135deg,#10B981,#06B6D4)', hasAlert:false },
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
      <span style={{ flex:1, fontSize:11, fontWeight:600 }}>{msg}</span>
    </div>
  );
}

function SearchBar({ placeholder, hint, value, onChange, onFilter }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:11, background:C.chip, borderRadius:18, padding:'11px 11px 11px 15px', boxShadow:'inset 0 0 0 1px rgba(16,24,40,0.04)' }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}><circle cx="11" cy="11" r="7" stroke="#8A93A6" strokeWidth="2"/><path d="m20 20-3.2-3.2" stroke="#8A93A6" strokeWidth="2" strokeLinecap="round"/></svg>
      <div style={{ flex:1, minWidth:0 }}>
        {onChange ? (
          <input value={value||''} onChange={onChange} placeholder={placeholder||'Search…'} style={{ width:'100%', boxSizing:'border-box', border:'none', background:'none', outline:'none', fontSize:13, fontWeight:600, color:C.body, fontFamily:"'Montserrat',-apple-system,sans-serif", padding:0 }} />
        ) : (
          <div style={{ fontSize:13, fontWeight:600, color:C.body }}>{placeholder}</div>
        )}
        {hint && <div style={{ fontSize:10, color:C.subtle, marginTop:3 }}>{hint}</div>}
      </div>
      {onFilter && (
        <button onClick={onFilter} style={{ flexShrink:0, width:40, height:40, border:'none', borderRadius:13, background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 4px 10px rgba(2,162,240,0.32)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 7h14M8 12h8M11 17h2" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
      )}
    </div>
  );
}

function Tabs({ tabs, active, onSelect }) {
  return (
    <div style={{ display:'flex', gap:8, overflowX:'auto', padding:'2px 16px', scrollbarWidth:'none' }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onSelect(t.id)} style={{ flexShrink:0, border:'none', cursor:'pointer', height:38, padding:'0 16px', borderRadius:999, fontSize:11.5, fontWeight:700, whiteSpace:'nowrap', fontFamily:"'Montserrat',-apple-system,sans-serif", transition:'all .15s', background: t.id===active ? C.primary : C.chip, color: t.id===active ? '#fff' : C.muted, boxShadow: t.id===active ? '0 4px 12px rgba(2,162,240,0.34)' : 'none' }}>
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
        {title && <div style={{ fontSize:17, fontWeight:800, color:C.ink, marginBottom:16 }}>{title}</div>}
        {children}
      </div>
    </>
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
        <span style={{ fontSize:8, fontWeight:navWeight('home'), color:navColor('home'), fontFamily:"'Montserrat',-apple-system,sans-serif" }}>Home</span>
      </button>
      {/* Spaces */}
      <button onClick={()=>setScreen('spaces')} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, border:'none', background:'none', cursor:'pointer', width:58 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="9" r="2.6" stroke={navColor('spaces')} strokeWidth="2"/><circle cx="16" cy="9" r="2.6" stroke={navColor('spaces')} strokeWidth="2"/><path d="M3.5 18c0-2.4 2-3.8 4.5-3.8M20.5 18c0-2.4-2-3.8-4.5-3.8M9 18c0-2 1.4-3.2 3-3.2s3 1.2 3 3.2" stroke={navColor('spaces')} strokeWidth="2" strokeLinecap="round"/></svg>
        <span style={{ fontSize:8, fontWeight:navWeight('spaces'), color:navColor('spaces'), fontFamily:"'Montserrat',-apple-system,sans-serif" }}>Groups</span>
      </button>
      {/* Discover */}
      <button onClick={()=>setScreen('discover')} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, border:'none', background:'none', cursor:'pointer', width:58 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke={navColor('discover')} strokeWidth="2"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" stroke={navColor('discover')} strokeWidth="2" strokeLinejoin="round"/></svg>
        <span style={{ fontSize:8, fontWeight:navWeight('discover'), color:navColor('discover'), fontFamily:"'Montserrat',-apple-system,sans-serif" }}>Discover</span>
      </button>
      {/* Messages */}
      <button onClick={()=>setScreen('messages')} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, border:'none', background:'none', cursor:'pointer', width:58, position:'relative' }}>
        <div style={{ position:'relative' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3.5V16.5H6a2 2 0 0 1-2-2Z" stroke={navColor('messages')} strokeWidth="2" strokeLinejoin="round"/></svg>
          {unreadCount > 0 && (
            <span style={{ position:'absolute', top:-4, right:-6, minWidth:16, height:16, padding:'0 4px', borderRadius:999, background:'#FF3B6B', color:'#fff', fontSize:8, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center' }}>{unreadCount > 99 ? '99+' : unreadCount}</span>
          )}
        </div>
        <span style={{ fontSize:8, fontWeight:navWeight('messages'), color:navColor('messages'), fontFamily:"'Montserrat',-apple-system,sans-serif" }}>Messages</span>
      </button>
      {/* Profile */}
      <button onClick={()=>setScreen('profile')} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, border:'none', background:'none', cursor:'pointer', width:58 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke={navColor('profile')} strokeWidth="2"/><path d="M5 20c0-3.6 3-5.6 7-5.6s7 2 7 5.6" stroke={navColor('profile')} strokeWidth="2" strokeLinecap="round"/></svg>
        <span style={{ fontSize:8, fontWeight:navWeight('profile'), color:navColor('profile'), fontFamily:"'Montserrat',-apple-system,sans-serif" }}>Profile</span>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: HOME FEED
// ─────────────────────────────────────────────────────────────
function HomeScreen({ liked, toggleLike, saved, toggleSave, following, toggleFollowing, filters, setFilters, activeCat, setActiveCat, query, setQuery, createOpen, setCreateOpen, role, setRole, navigate, showToast }) {
  const CATS = [
    {id:'trending',label:'Trending This Week'},{id:'new',label:'New'},{id:'popular',label:'Popular'},
    {id:'career',label:'Career'},{id:'sports',label:'Sports'},{id:'academic',label:'Academic'},{id:'social',label:'Social'},
  ];

  const { events: liveEvents, loading: eventsLoading } = useEvents({ category: activeCat, search: query, filters });
  const eventData = liveEvents.length > 0 ? liveEvents : EVENTS;
  let list = eventData.slice();
  if (activeCat==='new') list = [...list].reverse();
  else if (activeCat==='popular') list = [...list].sort((a,b)=>b.attendees-a.attendees);

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative', background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      {/* Header */}
      <div style={{ flexShrink:0, background:C.card, padding:'52px 16px 12px', boxShadow:'0 1px 0 rgba(16,24,40,0.06)', position:'relative', zIndex:4 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:9 }}>
            <div style={{ width:34, height:34, borderRadius:10, background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 10px rgba(2,162,240,0.32)' }}>
              <RiplyMark size={18} white />
            </div>
            <span style={{ fontSize:19, fontWeight:800, letterSpacing:-0.6, color:C.ink }}>Riply</span>
          </div>
          <button onClick={()=>setCreateOpen(true)} style={{ width:40, height:40, border:'none', borderRadius:13, background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 4px 10px rgba(2,162,240,0.32)' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/></svg>
          </button>
        </div>
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
      <div style={{ flex:1, overflowY:'auto', padding:'14px 16px 104px' }}>
        {list.length===0 && (
          <div style={{ textAlign:'center', padding:'48px 24px', color:C.subtle, fontSize:12 }}>No events match your search — try a different term.</div>
        )}
        {list.map(ev => {
          const th = THEME[ev.primary] || THEME[ev.category] || THEME.social;
          const isLiked = !!liked[ev.id];
          const isSaved = !!saved[ev.id];
          const isFollowing = !!following[ev.id];
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
                const isFree = ev.price === 'Free' || ev.price === 0 || ev.price === 'free';
                return (
                  <div onClick={()=>navigate('event-details',{eventId:ev.id})} style={{ position:'relative', height:172, overflow:'hidden', cursor:'pointer' }}>
                    <img src={cardImg} alt={ev.title}
                      style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', objectPosition:'center' }}/>
                    <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg,rgba(0,0,0,0.22) 0%,transparent 35%,transparent 55%,rgba(0,0,0,0.48) 100%)' }} />
                    {/* Top row: category chip + trending */}
                    <div style={{ position:'absolute', top:12, left:12, right:12, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                      <span style={{ display:'inline-flex', alignItems:'center', height:26, padding:'0 11px', borderRadius:999, background:'rgba(255,255,255,0.92)', fontSize:9, fontWeight:700, letterSpacing:0.3, color:C.body, backdropFilter:'blur(6px)' }}>{th.label}</span>
                      <div style={{ width:36, height:36, borderRadius:'50%', background:'rgba(255,255,255,0.92)', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(6px)', boxShadow:'0 2px 6px rgba(0,0,0,0.12)' }}>
                        <svg width="17" height="17" viewBox="0 0 24 24"><path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l1-8Z" fill={ev.trending?'#FFB020':'rgba(255,255,255,0)'} stroke={ev.trending?'#F59E0B':'#7B8499'} strokeWidth="1.6" strokeLinejoin="round"/></svg>
                      </div>
                    </div>
                    {/* Bottom row: free entry (left) + recurring badge (right) */}
                    <div style={{ position:'absolute', bottom:12, left:12, right:12, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                      {isFree
                        ? <span style={{ display:'inline-flex', alignItems:'center', height:24, padding:'0 10px', borderRadius:8, background:'rgba(16,185,129,0.88)', fontSize:9, fontWeight:700, color:'#fff', backdropFilter:'blur(6px)' }}>Free entry</span>
                        : <span/>}
                      {ev.badge && <span style={{ display:'inline-flex', alignItems:'center', height:24, padding:'0 10px', borderRadius:8, background:'rgba(14,23,38,0.55)', fontSize:9, fontWeight:700, color:'#fff', backdropFilter:'blur(6px)' }}>{ev.badge}</span>}
                    </div>
                  </div>
                );
              })()}

              {/* Content */}
              <div style={{ padding:'14px 16px' }}>
                <div onClick={()=>navigate('event-details',{eventId:ev.id})} style={{ fontSize:17, fontWeight:800, letterSpacing:-0.4, color:C.ink, lineHeight:1.2, cursor:'pointer' }}>{ev.title}</div>
                <div style={{ display:'flex', alignItems:'center', gap:14, marginTop:9, flexWrap:'wrap' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" stroke="#7B8499" strokeWidth="1.9"/><circle cx="12" cy="10" r="2.4" stroke="#7B8499" strokeWidth="1.9"/></svg>
                    <span style={{ fontSize:11, fontWeight:500, color:C.muted }}>{ev.location}</span>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:6 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="#7B8499" strokeWidth="1.9"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="#7B8499" strokeWidth="1.9" strokeLinecap="round"/></svg>
                  <span style={{ fontSize:11, fontWeight:600, color:'#0094E0' }}>
                    {ev.date || '-'}{(ev.start_time || ev.startTime) ? (' · ' + (ev.start_time || ev.startTime)) : (ev.time_range ? ' · ' + ev.time_range.split(' – ')[0] : '')}
                  </span>
                </div>
                <div style={{ fontSize:11.5, lineHeight:1.5, color:'#6B7385', marginTop:10, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{ev.desc || ev.description}</div>

                {/* Organizer row */}
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:13 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:9, minWidth:0 }}>
                    <div style={{ width:30, height:30, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:'#fff', background:th.org }}>{ev.orgInitial}</div>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.body, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{ev.org}</div>
                      <div style={{ fontSize:9, color:C.subtle }}>Organizer</div>
                    </div>
                  </div>
                  <button onClick={()=>toggleFollowing(ev.id)} style={{ flexShrink:0, border: isFollowing?'1.5px solid #E3E7EE':'none', background: isFollowing?'#fff':C.primary, color: isFollowing?'#7B8499':'#fff', height:32, padding:'0 17px', borderRadius:999, fontSize:10.5, fontWeight:700, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
                    {isFollowing ? 'Following' : 'Follow'}
                  </button>
                </div>

                {/* Divider */}
                <div style={{ height:1, background:C.divider, margin:'13px 0 11px' }} />

                {/* Metrics */}
                <div style={{ display:'flex', alignItems:'center', gap:18 }}>
                  <button onClick={()=>toggleLike(ev.id)} style={{ display:'flex', alignItems:'center', gap:6, border:'none', background:'none', padding:0, cursor:'pointer' }}>
                    <svg width="19" height="19" viewBox="0 0 24 24"><path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7C20.5 15 12 20.5 12 20.5Z" fill={isLiked?'#FF3B6B':'rgba(0,0,0,0)'} stroke={isLiked?'#FF3B6B':'#9AA3B2'} strokeWidth="1.8" strokeLinejoin="round"/></svg>
                    <span style={{ fontSize:11, fontWeight:700, color:isLiked?'#FF3B6B':C.subtle }}>{fmt(ev.likes+(isLiked?1:0))}</span>
                  </button>
                  <button onClick={()=>toggleSave(ev.id)} style={{ display:'flex', alignItems:'center', gap:6, border:'none', background:'none', padding:0, cursor:'pointer' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24"><path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z" fill={isSaved?'#0098F0':'rgba(0,0,0,0)'} stroke={isSaved?'#0098F0':'#9AA3B2'} strokeWidth="1.7" strokeLinejoin="round"/></svg>
                    <span style={{ fontSize:11, fontWeight:700, color:isSaved?C.primary:C.subtle }}>{fmt(ev.saves+(isSaved?1:0))}</span>
                  </button>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M14 9V6.5a2 2 0 0 1 3.4-1.4l3.6 5a1.5 1.5 0 0 1 0 1.8l-3.6 5A2 2 0 0 1 14 15.5V13c-6 0-8 3-8 3s0-7 8-7Z" stroke="#7B8499" strokeWidth="1.8" strokeLinejoin="round"/></svg>
                    <span style={{ fontSize:11, fontWeight:700, color:'#7B8499' }}>{fmt(ev.shares)}</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginLeft:'auto' }}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8.5" r="3" stroke="#7B8499" strokeWidth="1.8"/><path d="M3.5 19c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" stroke="#7B8499" strokeWidth="1.8" strokeLinecap="round"/><path d="M16 6a3 3 0 0 1 0 5.5M17 14.6c2.6.3 4.5 1.8 4.5 4.4" stroke="#7B8499" strokeWidth="1.8" strokeLinecap="round"/></svg>
                    <span style={{ fontSize:11, fontWeight:700, color:C.body }}>{(ev.attendee_count || ev.attendees) ? fmt(ev.attendee_count || ev.attendees) : '-'} <span style={{ color:C.subtle, fontWeight:500 }}>going</span></span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* FAB — My Tickets */}
      <button onClick={()=>navigate('my-tickets')} style={{ position:'absolute', bottom:94, right:18, width:60, height:60, border:'none', borderRadius:20, background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 10px 24px rgba(2,162,240,0.45),0 2px 6px rgba(2,162,240,0.3)', zIndex:6 }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M4 8.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 1.8 1.8 0 0 0 0 3.4 1.8 1.8 0 0 0 0 3.6 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 1.8 1.8 0 0 0 0-3.6 1.8 1.8 0 0 0 0-3.4Z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round"/><path d="M14 7.5v9" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeDasharray="0.5 3"/></svg>
      </button>

      {/* Create Sheet */}
      {createOpen && (
        <Sheet onClose={()=>setCreateOpen(false)} title="Create something">
          <div style={{ fontSize:10.5, color:C.subtle, marginBottom:14 }}>Signed in as <span style={{ fontWeight:700, color:C.primary }}>{role==='admin'?'Group Admin':role==='organizer'?'Event Organizer':'Student'}</span></div>
          {/* Role switcher */}
          <div style={{ display:'flex', gap:6, background:'#E9ECF2', borderRadius:13, padding:4, marginBottom:16 }}>
            {(['student','organizer','admin']).map(r => (
              <button key={r} onClick={()=>setRole(r)} style={{ flex:1, height:36, border:'none', borderRadius:10, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", fontSize:9.5, fontWeight:700, background: role===r?C.card:'none', color: role===r?C.primary:'#7B8499', boxShadow: role===r?'0 2px 6px rgba(16,24,40,0.08)':'none' }}>
                {r==='admin'?'Admin':r==='organizer'?'Organizer':'Student'}
              </button>
            ))}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:11 }}>
            {/* Space — all */}
            <div onClick={()=>{setCreateOpen(false);navigate('create-space');}} style={{ display:'flex', alignItems:'center', gap:13, background:C.card, borderRadius:16, padding:15, boxShadow:'0 4px 14px rgba(16,24,40,0.05)', cursor:'pointer' }}>
              <div style={{ width:46, height:46, borderRadius:13, flexShrink:0, background:'#E4F7EC', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width="23" height="23" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="#15A34A" strokeWidth="2"/><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" stroke="#15A34A" strokeWidth="2"/></svg>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:800, color:C.ink }}>Student Space</div>
                <div style={{ fontSize:10, color:C.subtle, marginTop:2 }}>A small recurring group — open to all students</div>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke="#C5CBD6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            {/* Post — all roles */}
            <div onClick={()=>{setCreateOpen(false);navigate('create-post');}} style={{ display:'flex', alignItems:'center', gap:13, background:C.card, borderRadius:16, padding:15, boxShadow:'0 4px 14px rgba(16,24,40,0.05)', cursor:'pointer' }}>
              <div style={{ width:46, height:46, borderRadius:13, flexShrink:0, background:'#FFF6EC', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 19h3l9-9-3-3-9 9v3Z" stroke="#F59E0B" strokeWidth="1.9" strokeLinejoin="round"/><path d="m14.5 6.5 3 3" stroke="#F59E0B" strokeWidth="1.9" strokeLinecap="round"/></svg>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:800, color:C.ink }}>Post</div>
                <div style={{ fontSize:10, color:C.subtle, marginTop:2 }}>Share something with a group</div>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke="#C5CBD6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            {/* Event — organizer/admin only */}
            {role!=='student' ? (
              <div onClick={()=>{setCreateOpen(false);navigate('create-event');}} style={{ display:'flex', alignItems:'center', gap:13, background:C.card, borderRadius:16, padding:15, boxShadow:'0 4px 14px rgba(16,24,40,0.05)', cursor:'pointer' }}>
                <div style={{ width:46, height:46, borderRadius:13, flexShrink:0, background:'#E9F6FF', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width="23" height="23" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke={C.primary} strokeWidth="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke={C.primary} strokeWidth="2" strokeLinecap="round"/></svg>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:800, color:C.ink }}>Event</div>
                  <div style={{ fontSize:10, color:C.subtle, marginTop:2 }}>Ticketed campus event with RSVPs & check-in</div>
                </div>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke="#C5CBD6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:13, background:'#F1F3F7', borderRadius:16, padding:15, opacity:0.85 }}>
                <div style={{ width:46, height:46, borderRadius:13, flexShrink:0, background:'#E4E8EF', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" stroke={C.subtle} strokeWidth="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke={C.subtle} strokeWidth="2" strokeLinecap="round"/></svg>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:800, color:C.muted }}>Event</div>
                  <div style={{ fontSize:10, color:C.subtle, marginTop:2 }}>Only organizers & group admins can post events</div>
                </div>
              </div>
            )}
            {/* Campus Group — admin only */}
            {role==='admin' ? (
              <div onClick={()=>{setCreateOpen(false);navigate('create-group');}} style={{ display:'flex', alignItems:'center', gap:13, background:C.card, borderRadius:16, padding:15, boxShadow:'0 4px 14px rgba(16,24,40,0.05)', cursor:'pointer' }}>
                <div style={{ width:46, height:46, borderRadius:13, flexShrink:0, background:'#F1ECFF', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width="23" height="23" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="9" r="2.6" stroke="#7C5CFF" strokeWidth="2"/><circle cx="16" cy="9" r="2.6" stroke="#7C5CFF" strokeWidth="2"/><path d="M3.5 18c0-2.4 2-3.8 4.5-3.8M20.5 18c0-2.4-2-3.8-4.5-3.8M9 18c0-2 1.4-3.2 3-3.2s3 1.2 3 3.2" stroke="#7C5CFF" strokeWidth="2" strokeLinecap="round"/></svg>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:800, color:C.ink }}>Campus Group</div>
                  <div style={{ fontSize:10, color:C.subtle, marginTop:2 }}>A community with members, posts & moderation</div>
                </div>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke="#C5CBD6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:13, background:'#F1F3F7', borderRadius:16, padding:15, opacity:0.85 }}>
                <div style={{ width:46, height:46, borderRadius:13, flexShrink:0, background:'#E4E8EF', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" stroke={C.subtle} strokeWidth="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke={C.subtle} strokeWidth="2" strokeLinecap="round"/></svg>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:800, color:C.muted }}>Campus Group</div>
                  <div style={{ fontSize:10, color:C.subtle, marginTop:2 }}>Only group admins can create groups</div>
                </div>
              </div>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: SPACES (Campus Groups)
// ─────────────────────────────────────────────────────────────
function SpacesScreen({ spaceTab, setSpaceTab, spaceJoined, setSpaceJoined, spaceNotify, setSpaceNotify, progress, navigate, showToast }) {
  const TABS = [{id:'today',label:'Today'},{id:'tomorrow',label:'Tomorrow'},{id:'academic',label:'Academic'},{id:'social',label:'Social'},{id:'sports',label:'Sports'}];

  const { spaces: liveSpaces } = useSpaces();
  const spaceData = liveSpaces.length > 0 ? liveSpaces : SPACES;
  let list = spaceData.slice();
  if(spaceTab==='today'||spaceTab==='tomorrow') list=list.filter(s=>s.day===spaceTab);
  else list=list.filter(s=>(s.cat||s.category)===spaceTab);

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative', background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink:0, background:C.card, padding:'52px 16px 12px', boxShadow:'0 1px 0 rgba(16,24,40,0.06)', zIndex:4 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:9 }}>
            <div style={{ width:34, height:34, borderRadius:10, background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 10px rgba(2,162,240,0.32)' }}>
              <RiplyMark size={18} white />
            </div>
            <span style={{ fontSize:19, fontWeight:800, letterSpacing:-0.6, color:C.ink }}>Spaces</span>
          </div>
          <button onClick={()=>showToast("You're all caught up — no new notifications")} style={{ position:'relative', width:40, height:40, border:'none', borderRadius:13, background:C.chip, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5Z" stroke="#39414F" strokeWidth="1.9" strokeLinejoin="round"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0" stroke="#39414F" strokeWidth="1.9" strokeLinecap="round"/></svg>
            <span style={{ position:'absolute', top:8, right:9, width:8, height:8, borderRadius:'50%', background:'#FF3B6B', border:`2px solid ${C.chip}` }} />
          </button>
        </div>
        <SearchBar placeholder="What can we help you find?" hint='Try "Study groups near me"' onFilter={()=>navigate('filters',{from:'spaces'})} />
      </div>

      {/* Tabs */}
      <div style={{ flexShrink:0, background:C.card, padding:'8px 0 12px', boxShadow:'0 1px 0 rgba(16,24,40,0.04)' }}>
        <Tabs tabs={TABS} active={spaceTab} onSelect={setSpaceTab} />
      </div>

      {/* Spaces list */}
      <div style={{ flex:1, overflowY:'auto', padding:'14px 16px 104px' }}>
        {list.length===0 && <div style={{ textAlign:'center', padding:'48px 24px', color:C.subtle, fontSize:12 }}>No spaces in this category right now.</div>}
        {list.map(sp => {
          const isJoined = !!spaceJoined[sp.id];
          const count = sp.participants + (isJoined?1:0);
          const isFull = count >= (sp.max_spots || sp.max || 10);
          const notifyOn = !!spaceNotify[sp.id];
          const prog = sp.started ? (progress[sp.id]??0) : 0;
          const done = prog>=100;

          return (
            <div key={sp.id} style={{ background:C.card, borderRadius:22, boxShadow:'0 8px 24px rgba(16,24,40,0.07),0 1px 2px rgba(16,24,40,0.04)', marginBottom:16, padding:'16px 16px 14px' }}>
              {/* Title + Avatar */}
              <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div onClick={()=>navigate('space-details',{spaceId:sp.id})} style={{ fontSize:16, fontWeight:800, letterSpacing:-0.4, color:C.ink, lineHeight:1.2, cursor:'pointer' }}>{sp.title}</div>
                  <div style={{ fontSize:11, color:'#7B8499', marginTop:3, lineHeight:1.4 }}>{sp.desc || sp.description || ""}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:7 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" stroke={C.subtle} strokeWidth="1.9"/><circle cx="12" cy="10" r="2.4" stroke={C.subtle} strokeWidth="1.9"/></svg>
                    <span style={{ fontSize:10.5, fontWeight:600, color:'#8A93A6' }}>{sp.location}</span>
                  </div>
                </div>
                <div style={{ width:50, height:50, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:15, fontWeight:800, background:sp.avatarColor || sp.avatar_color || "linear-gradient(135deg,#19BFFF,#0098F0)", boxShadow:'0 4px 10px rgba(16,24,40,0.12)', overflow:'hidden' }}>
                  {sp.image_url ? <img src={sp.image_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/> : (sp.avatarInitial || sp.avatar_initial || "S")}
                </div>
              </div>

              {/* Stats row */}
              <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginTop:15 }}>
                {[{label:'Participants',val:`${count}/${sp.max_spots || sp.max || 10}`,color:C.body},{label:'Time',val:sp.time,color:C.primary},{label:'Duration',val:(/^\d+$/.test(String(sp.duration||''))?`${sp.duration} min`:sp.duration)||'—',color:C.body}].map(s=>(
                  <div key={s.label} style={{ flex:1 }}>
                    <div style={{ fontSize:8.5, fontWeight:700, letterSpacing:0.4, textTransform:'uppercase', color:C.subtle }}>{s.label}</div>
                    <div style={{ fontSize:14, fontWeight:800, color:s.color, marginTop:3 }}>{s.val}</div>
                  </div>
                ))}
              </div>

              {/* Live progress */}
              {sp.started && (
                <div style={{ marginTop:14 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:7 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ position:'relative', width:8, height:8, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                        <span style={{ position:'absolute', width:8, height:8, borderRadius:'50%', background:'#10B981', opacity:0.5, animation:'riplyPulse 1.6s ease-out infinite' }} />
                        <span style={{ width:8, height:8, borderRadius:'50%', background:'#10B981' }} />
                      </span>
                      <span style={{ fontSize:9.5, fontWeight:800, color:'#10B981', letterSpacing:0.2 }}>{done?'ENDED':'IN PROGRESS'}</span>
                    </div>
                    <span style={{ fontSize:9.5, fontWeight:700, color:C.subtle }}>{done?'Completed':(sp.endTime?`Ends ${sp.endTime}`:`${Math.round(prog)}%`)}</span>
                  </div>
                  <div style={{ position:'relative', height:8, borderRadius:999, background:'#EAEDF2' }}>
                    <div style={{ position:'absolute', left:0, top:0, bottom:0, borderRadius:999, background:'linear-gradient(90deg,#34D399,#10B981)', width:`${prog}%`, transition:'width .6s linear' }} />
                    <div style={{ position:'absolute', top:'50%', transform:'translate(-50%,-50%)', left:`${prog}%`, width:15, height:15, borderRadius:'50%', background:'#fff', border:'3px solid #10B981', boxShadow:'0 2px 5px rgba(16,185,129,0.4)', transition:'left .6s linear' }} />
                  </div>
                </div>
              )}

              {/* Action */}
              {isFull ? (
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:15 }}>
                    <button style={{ flex:1, height:50, border:'none', borderRadius:15, background:C.subtle, color:'#fff', fontSize:13, fontWeight:800, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                      Space Full
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="1.9"/><path d="m6 6 12 12" stroke="#fff" strokeWidth="1.9" strokeLinecap="round"/></svg>
                    </button>
                    <button onClick={()=>setSpaceNotify(n=>({...n,[sp.id]:!n[sp.id]}))} style={{ width:50, height:50, borderRadius:15, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', border:notifyOn?'none':'1.6px solid #E3E7EE', background:notifyOn?'#E9F6FF':'#fff' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5Z" stroke={notifyOn?C.primary:'#7B8499'} fill={notifyOn?'#E9F6FF':'none'} strokeWidth="1.9" strokeLinejoin="round"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0" stroke={notifyOn?C.primary:'#7B8499'} strokeWidth="1.9" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                  {notifyOn && <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:9, justifyContent:'center' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="#10B981" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <span style={{ fontSize:10, fontWeight:700, color:'#10B981' }}>We'll notify you the moment a spot opens up</span>
                  </div>}
                </div>
              ) : (
                <button onClick={()=>setSpaceJoined(j=>({...j,[sp.id]:!j[sp.id]}))} style={{ width:'100%', marginTop:15, height:50, border: isJoined?'1.6px solid #10B981':'none', borderRadius:15, background: isJoined?'#E6F8F0':C.grad, color: isJoined?'#0E9F6E':'#fff', fontSize:13, fontWeight:800, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", display:'flex', alignItems:'center', justifyContent:'center', gap:8, boxShadow:isJoined?'none':'0 8px 20px rgba(2,162,240,0.4)' }}>
                  <span>{isJoined?"You're in · Joined":'Join Space'}</span>
                  {!isJoined && <span style={{ fontWeight:800 }}>{(sp.is_free || !sp.price || sp.price === 'Free') ? 'Free' : `$${sp.price}`}</span>}
                </button>
              )}

              {/* Host */}
              <div style={{ fontSize:9.5, color:C.subtle, textAlign:'center', marginTop:10 }}>Created by {(sp.hostText || sp.host_text || '').replace(/^(Created by |Organized by )/i,'') || 'Organizer'}</div>
            </div>
          );
        })}
      </div>

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
  const TABS = [{id:'popular',label:'Popular'},{id:'all',label:'All'},{id:'culture',label:'Culture'},{id:'religion',label:'Religion'},{id:'social',label:'Social'},{id:'academic',label:'Academic'},{id:'sports',label:'Sports'}];

const { groups: liveGroups } = useGroups();
  const groupData = liveGroups.length > 0 ? liveGroups : GROUPS;
  let list = groupData.slice();
  if(discoverTab!=='popular'&&discoverTab!=='all') list=list.filter(g=>((g.cat || g.category || [])||g.category||[]).includes(discoverTab));

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative', background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink:0, background:C.card, padding:'52px 16px 12px', boxShadow:'0 1px 0 rgba(16,24,40,0.06)', zIndex:4 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:9 }}>
            <div style={{ width:34, height:34, borderRadius:10, background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 10px rgba(2,162,240,0.32)' }}>
              <RiplyMark size={18} white />
            </div>
            <span style={{ fontSize:19, fontWeight:800, letterSpacing:-0.6, color:C.ink }}>Discover</span>
          </div>
          <button onClick={()=>showToast("You're all caught up — no new notifications")} style={{ position:'relative', width:40, height:40, border:'none', borderRadius:13, background:C.chip, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5Z" stroke="#39414F" strokeWidth="1.9" strokeLinejoin="round"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0" stroke="#39414F" strokeWidth="1.9" strokeLinecap="round"/></svg>
            <span style={{ position:'absolute', top:8, right:9, width:8, height:8, borderRadius:'50%', background:'#FF3B6B', border:`2px solid ${C.chip}` }} />
          </button>
        </div>
        <SearchBar placeholder="What can we help you find?" hint='Try "Clubs to join this semester"' onFilter={()=>navigate('filters',{from:'discover'})} />
      </div>

      {/* Tabs */}
      <div style={{ flexShrink:0, background:C.card, padding:'8px 0 12px', boxShadow:'0 1px 0 rgba(16,24,40,0.04)' }}>
        <Tabs tabs={TABS} active={discoverTab} onSelect={setDiscoverTab} />
      </div>

      {/* Groups */}
      <div style={{ flex:1, overflowY:'auto', padding:'14px 16px 104px' }}>
        {list.length===0 && <div style={{ textAlign:'center', padding:'48px 24px', color:C.subtle, fontSize:12 }}>No groups in this category yet.</div>}
        {list.map(g => {
          const localJoined = !!groupJoined[g.id];
          const isJoined = (g.state || "join") === 'joined' || localJoined;
          const isReq = (g.state || "join") === 'request' && !localJoined;

          let joinLabel;
          let joinStyle = {};
          if(isReq) { joinLabel='Request'; joinStyle={ border:'1.6px solid #E3E7EE', background:'#fff', color:'#5B6473' }; }
          else if(isJoined) { joinLabel='Joined ✓'; joinStyle={ border:'1.6px solid #10B981', background:'#E6F8F0', color:'#0E9F6E' }; }
          else { joinLabel='Join'; joinStyle={ border:'none', background:C.primary, color:'#fff', boxShadow:'0 4px 10px rgba(2,162,240,0.3)' }; }

          return (
            <div key={g.id} style={{ background:C.card, borderRadius:20, boxShadow:'0 6px 20px rgba(16,24,40,0.06)', marginBottom:14, padding:15 }}>
              <div onClick={()=>navigate('group-profile',{groupId:g.id})} style={{ display:'flex', gap:13, cursor:'pointer' }}>
                <div style={{ width:58, height:58, borderRadius:16, flexShrink:0, background:g.logoColor || g.logo_color || "linear-gradient(135deg,#19BFFF,#0098F0)", position:'relative', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 10px rgba(16,24,40,0.1)' }}>
                  <span style={{ fontSize:18, fontWeight:800, color:'#fff' }}>{g.initial || (g.name || "G")[0].toUpperCase()}</span>
                  <div style={{ position:'absolute', inset:0, background:'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 13px)' }} />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:14, fontWeight:800, letterSpacing:-0.3, color:C.ink, lineHeight:1.2 }}>{g.name}</span>
                    {isReq && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}><rect x="5" y="11" width="14" height="9" rx="2.2" stroke={C.subtle} strokeWidth="1.9"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke={C.subtle} strokeWidth="1.9"/></svg>}
                  </div>
                  <div style={{ fontSize:11, lineHeight:1.45, color:'#7B8499', marginTop:4, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{g.desc || g.description || ""}</div>
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:13 }}>
                <div style={{ display:'flex', alignItems:'center' }}>
                 {['S','M','J','A','R'].slice(0, 5).map((initial,i)=>(
                    <div key={i} style={{ width:30, height:30, borderRadius:'50%', marginLeft: i>0?-8:0, border:'2.5px solid #fff', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:9, fontWeight:800, background:['#FF5A8A','#0098F0','#10B981','#7C5CFF','#FF8A3D'][i] }}>{initial}</div>
                  ))}
                  <span style={{ fontSize:11, fontWeight:700, color:C.muted, marginLeft:11 }}>{g.count || g.member_count || 0}</span>
                  <span style={{ fontSize:10, color:C.subtle, marginLeft:4 }}>members</span>
                </div>
                <button onClick={async ()=>{
                  const nowJoined = !isJoined;
                  setGroupJoined(j=>({...j,[g.id]:nowJoined}));
                  const isUuid = typeof g.id === 'string' && g.id.includes('-');
                  if (user?.id && isUuid) {
                    if (nowJoined) await supabase.from('group_members').upsert({ group_id: g.id, user_id: user.id, role:'member' });
                    else await supabase.from('group_members').delete().eq('group_id', g.id).eq('user_id', user.id);
                  }
                }} style={{ flexShrink:0, height:38, padding:'0 20px', borderRadius:999, fontSize:12, fontWeight:800, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", ...joinStyle }}>
                  {joinLabel}
                </button>
              </div>
            </div>
          );
        })}
      </div>

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
function MessagesScreen({ msgTab, setMsgTab, navigate, showToast, notifs }) {
  const isNotif = msgTab==='notifications';
  const { chats, loading: chatsLoading } = useChats();
  const { notifications, loading: notifsLoading, unreadCount, markRead, markAllRead, deleteNotification } = notifs;
  const activeTabStyle = { border:'none', background:'none', cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", fontSize:14, fontWeight:800, color:C.primary, padding:'0 0 4px' };
  const idleTabStyle = { ...activeTabStyle, fontWeight:700, color:C.subtle };

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative', background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      {/* Header */}
      <div style={{ flexShrink:0, background:C.card, padding:'52px 16px 0', boxShadow:'0 1px 0 rgba(16,24,40,0.04)', zIndex:4 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <span style={{ fontSize:22, fontWeight:800, letterSpacing:-0.6, color:C.ink }}>My Messages</span>
          <div style={{ display:'flex', gap:9 }}>
            <button onClick={()=>showToast('Search your messages')} style={{ width:40, height:40, border:'none', borderRadius:'50%', background:C.chip, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="#39414F" strokeWidth="2"/><path d="m20 20-3.2-3.2" stroke="#39414F" strokeWidth="2" strokeLinecap="round"/></svg>
            </button>
            <button onClick={()=>showToast('Start a new conversation')} style={{ width:40, height:40, border:'none', borderRadius:'50%', background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', boxShadow:'0 4px 10px rgba(2,162,240,0.32)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 19h3l9-9-3-3-9 9v3Z" stroke="#fff" strokeWidth="1.9" strokeLinejoin="round"/><path d="m14.5 6.5 3 3" stroke="#fff" strokeWidth="1.9" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>
        {/* Tabs */}
        <div style={{ display:'flex', gap:26 }}>
          <button onClick={()=>setMsgTab('notifications')} style={isNotif?activeTabStyle:idleTabStyle}>
            Notifications
            {unreadCount > 0 && <span style={{ marginLeft:6, display:'inline-flex', alignItems:'center', justifyContent:'center', minWidth:18, height:18, padding:'0 5px', borderRadius:999, background:'#FF3B6B', color:'#fff', fontSize:8, fontWeight:800, verticalAlign:'middle' }}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </button>
          <button onClick={()=>setMsgTab('chats')} style={isNotif?idleTabStyle:activeTabStyle}>Chats</button>
        </div>
        <div style={{ position:'relative', height:2, background:'#EEF0F4', marginTop:11 }}>
          <div style={{ position:'absolute', bottom:0, height:2.5, borderRadius:2, background:C.primary, width: isNotif?'108px':'52px', left: isNotif?'0px':'134px', transition:'all .25s ease' }} />
        </div>
      </div>

      {/* Body */}
      <div style={{ flex:1, overflowY:'auto', padding:'14px 16px 104px' }}>
        {isNotif ? (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {/* Mark all read */}
            {unreadCount > 0 && (
              <button onClick={markAllRead} style={{ alignSelf:'flex-end', border:'none', background:'none', fontSize:11, fontWeight:700, color:C.primary, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", padding:'2px 0' }}>
                Mark all as read
              </button>
            )}
            {notifsLoading ? (
              <div style={{ textAlign:'center', color:C.subtle, fontSize:13, paddingTop:40 }}>Loading…</div>
            ) : notifications.length === 0 ? (
              <div style={{ textAlign:'center', paddingTop:48 }}>
                <div style={{ fontSize:36, marginBottom:12 }}>🔔</div>
                <div style={{ fontSize:14, fontWeight:700, color:C.ink }}>All caught up</div>
                <div style={{ fontSize:12, color:C.subtle, marginTop:6 }}>No notifications yet</div>
              </div>
            ) : notifications.map(n => (
              <div key={n.id} onClick={() => markRead(n.id)}
                style={{ background: n.read ? C.card : '#F0F8FF', borderRadius:18,
                         boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:14,
                         cursor:'pointer', position:'relative',
                         borderLeft: n.read ? 'none' : `3px solid ${C.primary}` }}>
                <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                  <div style={{ width:46, height:46, borderRadius:'50%', flexShrink:0, background:n.color,
                                display:'flex', alignItems:'center', justifyContent:'center',
                                color:'#fff', fontSize:16, position:'relative', overflow:'hidden' }}>
                    <span>{n.initial}</span>
                    <div style={{ position:'absolute', inset:0, background:'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 12px)' }} />
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight: n.read ? 700 : 800, color:C.ink }}>{n.title}</div>
                    <div style={{ fontSize:11, lineHeight:1.45, color:'#7B8499', marginTop:3 }}>{n.body}</div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6, flexShrink:0 }}>
                    <span style={{ fontSize:9, color:C.subtle, fontWeight:600 }}>{n.time}</span>
                    <button onClick={e => { e.stopPropagation(); deleteNotification(n.id); }}
                      style={{ border:'none', background:'none', cursor:'pointer', padding:2, color:C.subtle, fontSize:14, lineHeight:1 }}>×</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:11 }}>
            {chatsLoading ? (
              <div style={{ textAlign:'center', color:C.subtle, fontSize:13, paddingTop:40 }}>Loading…</div>
            ) : chats.length === 0 ? (
              <div style={{ textAlign:'center', color:C.subtle, fontSize:13, paddingTop:40 }}>No conversations yet</div>
            ) : chats.map(c => (
              <div key={c.id} onClick={()=>navigate('chat',{chatId:c.id})} style={{ display:'flex', gap:12, alignItems:'center', background:C.card, borderRadius:18, boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:'13px 14px', cursor:'pointer' }}>
                <div style={{ width:50, height:50, borderRadius:'50%', flexShrink:0, background:c.color || C.grad, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:14, fontWeight:800, position:'relative', overflow:'hidden' }}>
                  <span>{c.initial || (c.name?.[0]?.toUpperCase() || '?')}</span>
                  <div style={{ position:'absolute', inset:0, background:'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 12px)' }} />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                    <span style={{ fontSize:13, fontWeight:800, color:C.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.name}</span>
                    <span style={{ fontSize:9, color:C.subtle, fontWeight:600, flexShrink:0 }}>{c.time}</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginTop:3 }}>
                    <span style={{ fontSize:11, color: c.unread?C.body:'#8A93A6', fontWeight: c.unread?700:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.preview}</span>
                    {c.unread && <span style={{ flexShrink:0, minWidth:20, height:20, padding:'0 6px', borderRadius:999, background:C.primary, color:'#fff', fontSize:9, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center' }}>{c.unreadCount}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}






// ─────────────────────────────────────────────────────────────
// SCREEN: CREATE POST
// ─────────────────────────────────────────────────────────────
function CreatePostScreen({ goBack, groupId, showToast }) {
  const { user } = useUser();
  const currentUser = useCurrentUser();
  const defaultGroup = GROUPS.find(g => g.id === groupId) || GROUPS.find(g => (g.state || "join") === 'joined') || GROUPS[0];

  const [text,       setText]       = useState('');
  const [hasPhoto,   setHasPhoto]   = useState(false);
  const [imageUrl,   setImageUrl]   = useState(null);
  const [hasPoll,    setHasPoll]    = useState(false);
  const [pollOpts,   setPollOpts]   = useState(['', '']);
  const [group,      setGroup]      = useState(defaultGroup?.name || '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [posting,    setPosting]    = useState(false);

  const joinedGroups = GROUPS.filter(g => (g.state || "join") === 'joined');

  const canPost = hasPoll
    ? text.trim().length > 0 && pollOpts.filter(o => o.trim()).length >= 2
    : !!(text.trim() || hasPhoto);

  const handlePost = async () => {
    if (!canPost) {
      showToast(hasPoll ? 'Write a question and add at least 2 options' : 'Write something or add a photo');
      return;
    }
    setPosting(true);
    const matchedGroup = GROUPS.find(g => g.name === group);
    const authorName = currentUser.name || user?.username || 'Member';
    const { error } = await supabase.from('posts').insert({
      content:        text,
      group_id:       matchedGroup?.id || groupId || null,
      user_id:        user?.id,
      image_url:      imageUrl,
      likes_count:    0,
      comment_count:  0,
      author_name:    authorName,
      author_initial: authorName[0]?.toUpperCase() || 'M',
      author_color:   'linear-gradient(135deg,#7C5CFF,#B06BFF)',
    });
    setPosting(false);
    if (error) { showToast('Failed to post'); return; }
    showToast(`Posted to ${group}`);
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
      onClick: () => setHasPhoto(true),
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
      onClick: () => showToast('Link a group event'),
    },
    {
      key: 'file', label: 'File', sub: 'Attach a doc',
      iconBg: '#FFF6EC', iconColor: '#F59E0B',
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M13 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.5L13 3.5Z" stroke="#F59E0B" strokeWidth="2" strokeLinejoin="round"/><path d="M13 3.5V9.5h6" stroke="#F59E0B" strokeWidth="2" strokeLinejoin="round"/></svg>,
      onClick: () => showToast('Attach a file'),
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

        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>
          Create Post
        </div>

        <button onClick={handlePost} style={{
          height:40, padding:'0 18px', border:'none', borderRadius:13, cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          fontSize:13, fontWeight:800, flexShrink:0,
          background: canPost ? 'linear-gradient(135deg,#19BFFF,#008FF0)' : '#E4E8EF',
          color: canPost ? '#fff' : '#A8B0BD',
          boxShadow: canPost ? '0 4px 10px rgba(2,162,240,0.3)' : 'none',
          transition: 'all .18s',
        }}>
          Post
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', padding:'16px 16px 30px' }}>

        {/* Author + group picker */}
        <div style={{ display:'flex', alignItems:'center', gap:11 }}>
          <div style={{ width:44, height:44, borderRadius:'50%', flexShrink:0,
                        background: currentUser?.avatar_url ? 'transparent' : 'linear-gradient(135deg,#FF8A3D,#FF5A8A)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:15, fontWeight:800, color:'#fff', overflow:'hidden' }}>
            {currentUser?.avatar_url
              ? <img src={currentUser.avatar_url} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt="" />
              : (currentUser?.name || user?.firstName || 'M')[0].toUpperCase()}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14.5, fontWeight:800, color:C.ink }}>{currentUser?.name || user?.username || user?.firstName || 'Member'}</div>

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
                <span style={{ fontSize:11.5, fontWeight:700, color:C.body }}>{group}</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="m6 9 6 6 6-6" stroke={C.subtle} strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* Group dropdown */}
              {pickerOpen && (
                <div style={{ position:'absolute', top:32, left:0, background:'#fff',
                              borderRadius:14, boxShadow:'0 6px 20px rgba(16,24,40,0.14)',
                              overflow:'hidden', zIndex:20, minWidth:200 }}>
                  {joinedGroups.map(g => (
                    <div key={g.id} onClick={() => { setGroup(g.name); setPickerOpen(false); }}
                      style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 14px',
                               cursor:'pointer', background: group===g.name ? '#EAF6FF' : '#fff',
                               borderBottom:`1px solid ${C.divider}` }}>
                      <div style={{ width:28, height:28, borderRadius:8, flexShrink:0,
                                    background:g.logoColor || g.logo_color || "linear-gradient(135deg,#19BFFF,#0098F0)", display:'flex', alignItems:'center',
                                    justifyContent:'center', color:'#fff',
                                    fontSize:11, fontWeight:800, position:'relative',
                                    overflow:'hidden' }}>
                        <span>{g.initial || (g.name || "G")[0].toUpperCase()}</span>
                        <div style={{ position:'absolute', inset:0, background:
                          'repeating-linear-gradient(135deg,rgba(255,255,255,0.14) 0,rgba(255,255,255,0.14) 2px,transparent 2px,transparent 8px)'}}/>
                      </div>
                      <span style={{ fontSize:13, fontWeight:700,
                                     color: group===g.name ? C.primary : C.body }}>
                        {g.name}
                      </span>
                      {group===g.name && (
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
                   background:'none', padding:'16px 2px 8px', fontSize:16, fontWeight:500,
                   lineHeight:1.55, color:C.body, outline:'none', resize:'none',
                   fontFamily:"'Montserrat',-apple-system,sans-serif" }}
        />

        {/* Photo attachment */}
        {hasPhoto && (
          <div style={{ position:'relative', height:190, borderRadius:16, overflow:'hidden',
                        marginTop:4, background:'linear-gradient(135deg,#5B6473,#8A93A6)' }}>
            <div style={{ position:'absolute', inset:0, background:
              'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 16px)'}}/>
            <span style={{ position:'absolute', bottom:10, left:12,
                           fontFamily:"'JetBrains Mono',monospace",
                           fontSize:10, color:'rgba(255,255,255,0.85)' }}>
              PHOTO · drag an image here
            </span>
            <button onClick={() => setHasPhoto(false)} style={{
              position:'absolute', top:10, right:10, width:30, height:30, border:'none',
              borderRadius:'50%', background:'rgba(14,23,38,0.6)',
              display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        )}

        {/* Poll builder */}
        {hasPoll && (
          <div style={{ background:'#fff', borderRadius:16,
                        boxShadow:'0 4px 14px rgba(16,24,40,0.05)', padding:15, marginTop:8 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                          marginBottom:11 }}>
              <span style={{ fontSize:13.5, fontWeight:800, color:C.ink }}>Poll</span>
              <button onClick={() => setHasPoll(false)} style={{
                border:'none', background:'none', cursor:'pointer',
                fontSize:12, fontWeight:700, color:C.danger,
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
                             fontSize:13.5, fontWeight:600, color:C.body, outline:'none',
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
                <span style={{ fontSize:13, fontWeight:800, color:C.primary }}>Add option</span>
              </button>
            )}
          </div>
        )}

        {/* Attach toolbar */}
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:0.4, textTransform:'uppercase',
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
              opacity: (a.key==='photo'&&hasPhoto)||(a.key==='poll'&&hasPoll) ? 0.5 : 1,
            }}>
              <div style={{ width:38, height:38, borderRadius:12, flexShrink:0,
                            display:'flex', alignItems:'center', justifyContent:'center',
                            background:a.iconBg }}>
                {a.icon}
              </div>
              <div style={{ flex:1, minWidth:0, textAlign:'left' }}>
                <div style={{ fontSize:13.5, fontWeight:800, color:C.ink }}>{a.label}</div>
                <div style={{ fontSize:11, color:C.subtle, marginTop:1 }}>{a.sub}</div>
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

    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// SCREEN: HELP CENTER
// ─────────────────────────────────────────────────────────────
function HelpCenterScreen({ goBack, navigate, showToast }) {
  const FAQS = [
    { q:'How do I buy a ticket for an event?', a:"Open any event, tap \"Buy Tickets\", choose your ticket type and quantity, then complete checkout. Your ticket and QR code appear instantly in My Tickets." },
    { q:'Can I get a refund?', a:"Refunds are available up to 24 hours before an event starts, as long as the organizer allows them. Go to My Tickets → select the ticket → Request Refund." },
    { q:'Who can create events?', a:"Only verified event organizers and group admins can publish events. Students can create student spaces and post in groups they belong to." },
    { q:'How do I join a private group?', a:"Open the group and tap \"Request to Join\". The group admins will review your request — you'll get a notification once it's approved." },
    { q:'How do I change my password?', a:"Go to Profile & Settings → Privacy & Security → Change Password. Enter your current password and your new one twice to confirm." },
    { q:'How does event check-in work?', a:"Organizers open the Check-In screen and scan each attendee's QR code from My Tickets. Valid tickets are marked checked-in in real time." },
  ];
  const TOPICS = [
    { title:'Events & Tickets', sub:'Buying, refunds, check-in',  iconBg:'#E9F6FF', iconColor:C.primary,   icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 1.8 1.8 0 0 0 0 3.4A1.8 1.8 0 0 0 20 16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 1.8 1.8 0 0 0 0-3.6A1.8 1.8 0 0 0 4 9Z" stroke={C.primary} strokeWidth="1.9" strokeLinejoin="round"/></svg> },
    { title:'Groups & Spaces',  sub:'Joining, posting, roles',    iconBg:'#E4F7EC', iconColor:'#15A34A',   icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="9" r="2.6" stroke="#15A34A" strokeWidth="1.9"/><circle cx="16" cy="9" r="2.6" stroke="#15A34A" strokeWidth="1.9"/><path d="M3.5 18c0-2.4 2-3.8 4.5-3.8M20.5 18c0-2.4-2-3.8-4.5-3.8M9 18c0-2 1.4-3.2 3-3.2s3 1.2 3 3.2" stroke="#15A34A" strokeWidth="1.9" strokeLinecap="round"/></svg> },
    { title:'Account',          sub:'Profile, password, privacy', iconBg:'#F1ECFF', iconColor:'#7C5CFF',  icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke="#7C5CFF" strokeWidth="1.9"/><path d="M5 20c0-3.6 3-5.6 7-5.6s7 2 7 5.6" stroke="#7C5CFF" strokeWidth="1.9" strokeLinecap="round"/></svg> },
    { title:'Payments',         sub:'Methods, receipts, billing', iconBg:'#FFF6EC', iconColor:'#F59E0B',  icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="6" width="17" height="12" rx="3" stroke="#F59E0B" strokeWidth="1.9"/><path d="M3.5 10h17" stroke="#F59E0B" strokeWidth="1.9"/></svg> },
  ];

  const [query,   setQuery]   = useState('');
  const [openIdx, setOpenIdx] = useState(-1);

  const q = query.trim().toLowerCase();
  const filtered = FAQS.filter(f => !q || (f.q + ' ' + f.a).toLowerCase().includes(q));

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
        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
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
            style={{ flex:1, border:'none', background:'none', fontSize:14.5, fontWeight:600,
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
            {TOPICS.map((t,i) => (
              <button key={i} onClick={() => showToast(t.title + ' articles')} style={{
                display:'flex', flexDirection:'column', gap:9, background:'#fff', border:'none',
                borderRadius:16, padding:15, cursor:'pointer', textAlign:'left',
                fontFamily:"'Montserrat',-apple-system,sans-serif",
                boxShadow:'0 4px 14px rgba(16,24,40,0.05)',
              }}>
                <div style={{ width:40, height:40, borderRadius:12, display:'flex',
                              alignItems:'center', justifyContent:'center',
                              background:t.iconBg }}>
                  {t.icon}
                </div>
                <div style={{ fontSize:13.5, fontWeight:800, color:C.ink }}>{t.title}</div>
                <div style={{ fontSize:11, color:C.subtle, lineHeight:1.3 }}>{t.sub}</div>
              </button>
            ))}
          </div>
        )}

        {/* FAQ */}
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:0.6, textTransform:'uppercase',
                      color:C.subtle, margin:'24px 4px 10px' }}>
          {query ? `Results for "${query}"` : 'Frequently Asked'}
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign:'center', padding:'30px 24px', color:C.subtle, fontSize:13 }}>
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
                    <span style={{ flex:1, fontSize:14, fontWeight:700, color:C.ink,
                                   lineHeight:1.35 }}>{f.q}</span>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                      style={{ flexShrink:0, transition:'transform .2s',
                               transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                      <path d="m9 6 6 6-6 6" stroke={C.subtle} strokeWidth="2.2"
                            strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  {open && (
                    <div style={{ padding:'0 15px 16px', fontSize:13, lineHeight:1.55,
                                  color:'#6B7385' }}>{f.a}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Contact */}
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:0.6, textTransform:'uppercase',
                      color:C.subtle, margin:'24px 4px 10px' }}>Still need help?</div>
        <div style={{ display:'flex', flexDirection:'column', gap:11 }}>
          {[
            { title:'Live Chat', sub:'Typically replies in a few minutes', iconBg:'#E9F6FF',
              icon:<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3.5V16.5H6a2 2 0 0 1-2-2Z" stroke={C.primary} strokeWidth="1.9" strokeLinejoin="round"/></svg>,
              onClick:() => showToast('Opening live chat…') },
            { title:'Email Support', sub:'support@riply.app', iconBg:'#F1ECFF',
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
                <div style={{ fontSize:14, fontWeight:800, color:C.ink }}>{item.title}</div>
                <div style={{ fontSize:11.5, color:C.subtle, marginTop:2 }}>{item.sub}</div>
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
        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
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
        <div style={{ fontSize:22, fontWeight:800, letterSpacing:-0.5, color:C.ink,
                      marginTop:22 }}>Thank you!</div>
        <div style={{ fontSize:13.5, lineHeight:1.55, color:'#7B8499', marginTop:9,
                      maxWidth:280 }}>
          Your feedback has been sent to the Riply team. We read every message and use it to improve the app.
        </div>
        <button onClick={goBack} style={{
          display:'flex', alignItems:'center', justifyContent:'center', width:'100%',
          height:52, marginTop:28, border:'none', borderRadius:16,
          background:C.grad, color:'#fff', fontSize:16, fontWeight:800, cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          boxShadow:'0 8px 20px rgba(2,162,240,0.4)',
        }}>
          Back to Settings
        </button>
        <button onClick={() => setSent(false)} style={{
          border:'none', background:'none', cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          fontSize:13.5, fontWeight:700, color:C.primary, marginTop:16,
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
        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Send Feedback</div>
        <div style={{ width:40 }}/>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 16px 30px' }}>
        <div style={{ fontSize:20, fontWeight:800, letterSpacing:-0.4, color:C.ink }}>
          How was your experience?
        </div>
        <div style={{ fontSize:13, color:'#7B8499', marginTop:6, lineHeight:1.5 }}>
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
        <div style={{ textAlign:'center', fontSize:13, fontWeight:700, color:C.primary,
                      marginTop:10, height:18 }}>
          {LABELS[rating] || ''}
        </div>

        {/* Category */}
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:0.5, textTransform:'uppercase',
                      color:C.subtle, margin:'22px 0 10px' }}>
          What's this about?
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:9 }}>
          {CATS.map(c => (
            <button key={c} onClick={() => setCategory(c)} style={{
              border: category===c ? 'none' : `1.5px solid ${C.border}`,
              cursor:'pointer', height:38, padding:'0 16px', borderRadius:999,
              fontSize:13, fontWeight:700,
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              background: category===c ? C.primary : '#fff',
              color: category===c ? '#fff' : C.muted,
              boxShadow: category===c ? '0 4px 12px rgba(2,162,240,0.3)' : 'none',
            }}>{c}</button>
          ))}
        </div>

        {/* Message */}
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:0.5, textTransform:'uppercase',
                      color:C.subtle, margin:'22px 0 10px' }}>
          Tell us more
        </div>
        <textarea value={message} onChange={e => setMessage(e.target.value)}
          placeholder="Share details, ideas, or a bug you ran into…"
          style={{ width:'100%', boxSizing:'border-box', minHeight:120,
                   border:`1.5px solid ${C.border}`, borderRadius:16, background:'#fff',
                   padding:14, fontSize:14, fontWeight:500, lineHeight:1.55,
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
          <span style={{ flex:1, textAlign:'left', fontSize:13.5, fontWeight:700,
                         color: attached ? C.primary : C.muted }}>
            {attached ? 'Screenshot attached ✓' : 'Attach a screenshot (optional)'}
          </span>
        </button>

        {/* Submit */}
        <button onClick={handleSubmit} style={{
          width:'100%', height:52, marginTop:22, border:'none', borderRadius:16,
          fontSize:16, fontWeight:800, cursor: canSubmit ? 'pointer' : 'not-allowed',
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
    padding:'0 0 12px', fontSize:13.5,
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
          <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
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
        <div style={{ fontSize:11.5, fontWeight:700, color:C.subtle, marginBottom:16 }}>
          Last updated June 1, 2026
        </div>
        {sections.map((s, i) => (
          <div key={i} style={{ marginBottom:20 }}>
            <div style={{ fontSize:15, fontWeight:800, color:C.ink, marginBottom:7 }}>
              {s.heading}
            </div>
            <div style={{ fontSize:13, lineHeight:1.62, color:'#5B6473' }}>{s.body}</div>
          </div>
        ))}
        <div style={{ background:'#fff', borderRadius:14, padding:15,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)', marginTop:6 }}>
          <div style={{ fontSize:12.5, lineHeight:1.55, color:'#7B8499' }}>
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
        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
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
          <div style={{ position:'relative', fontSize:28, fontWeight:800, letterSpacing:0.5,
                        color:'#fff', marginTop:12 }}>RIPLY</div>
          <div style={{ position:'relative', fontSize:12, fontWeight:700, letterSpacing:1.5,
                        color:'rgba(255,255,255,0.9)', marginTop:6 }}>
            CAMPUS CONNECTIONS MADE EASY
          </div>
          <div style={{ position:'relative', display:'inline-flex', alignItems:'center',
                        height:26, padding:'0 13px', borderRadius:999,
                        background:'rgba(255,255,255,0.2)', fontSize:11.5, fontWeight:700,
                        color:'#fff', marginTop:14 }}>
            Version 1.0.0
          </div>
        </div>

        {/* Mission */}
        <div style={{ padding:'22px 18px 0' }}>
          <div style={{ fontSize:13.5, lineHeight:1.62, color:'#5B6473' }}>
            Riply is the home for campus life. We help students discover events, join clubs and communities, buy tickets, and stay connected — while giving organizers the tools and insights to grow engagement on campus.
          </div>
        </div>

        {/* Stats */}
        <div style={{ display:'flex', gap:10, padding:'20px 18px 0' }}>
          {STATS.map(s => (
            <div key={s.label} style={{ flex:1, background:'#fff', borderRadius:16,
                                         padding:'15px 8px', textAlign:'center',
                                         boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
              <div style={{ fontSize:20, fontWeight:800, color:C.primary,
                            letterSpacing:-0.5 }}>{s.value}</div>
              <div style={{ fontSize:10.5, fontWeight:600, color:C.subtle,
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
                <span style={{ flex:1, textAlign:'left', fontSize:14.5, fontWeight:700,
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

        <div style={{ textAlign:'center', fontSize:11, color:'#B6BCC8', marginTop:22,
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
        <span style={{ fontSize:21, fontWeight:800, letterSpacing:-0.5, color:C.ink }}>
          Filters
        </span>
        <button onClick={clearAll} style={{ marginLeft:'auto', height:34, padding:'0 14px',
          border:'none', borderRadius:11, background:'transparent', fontSize:13,
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
                  <span style={{ fontSize:18, fontWeight:800, letterSpacing:-0.3, color:C.ink }}>
                    {sec.title}
                  </span>
                  {/* Active count badge for this section */}
                  {sec.opts.filter(o => selected[`${sec.id}:${o}`]).length > 0 && (
                    <span style={{ display:'inline-flex', alignItems:'center',
                                   justifyContent:'center', minWidth:20, height:20,
                                   padding:'0 6px', borderRadius:999,
                                   background:C.primary, color:'#fff',
                                   fontSize:10, fontWeight:800 }}>
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
                        fontSize:13, fontWeight:700, cursor:'pointer',
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
                  color:'#fff', fontSize:11, fontWeight:700, cursor:'pointer',
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
          color:'#fff', fontSize:15, fontWeight:800,
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
// SCREEN: GROUP PROFILE  (public & private)
// ─────────────────────────────────────────────────────────────
function GroupProfileScreen({ groupId, postLiked, togglePostLike, goBack, navigate, showToast }) {
  const { user } = useUser();
  const staticG = GROUPS.find(gr => gr.id === groupId) || GROUPS[0];
  const [dbGroup,     setDbGroup]     = useState(null);
  const [groupEvents, setGroupEvents] = useState([]);
  useEffect(() => {
    if (!groupId) return;
    supabase.from('groups').select('*').eq('id', groupId).single()
      .then(({ data }) => { if (data) setDbGroup(data); });
    supabase.from('events').select('*').eq('group_id', groupId).order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => { if (data?.length) setGroupEvents(data); });
    if (user?.id) {
      supabase.from('group_members').select('role').eq('group_id', groupId).eq('user_id', user.id).single()
        .then(({ data }) => {
          if (data) setJoinState(data.role === 'pending' ? 'requested' : 'joined');
        });
    }
  }, [groupId, user?.id]);
  const g = dbGroup || staticG;
  const { posts: livePosts, loading: postsLoading, createPost } = usePosts(groupId);

  const [joinState,  setJoinState]  = useState(staticG.state || "join");   // 'join'|'joined'|'request'|'requested'
  const [notifyOn,   setNotifyOn]   = useState((staticG.state || "join") === 'joined');
  const [activeTab,  setActiveTab]  = useState('posts');
  const [commentsOpen, setCommentsOpen] = useState(null);
  const [draft,      setDraft]      = useState('');
  const [comments,   setComments]   = useState({});

  const isPrivate  = joinState === 'request' || joinState === 'requested';
  const isJoined   = joinState === 'joined';
  const isRequested= joinState === 'requested';
  const canSee     = isJoined || (g.state || "join") === 'joined';

  const handlePrimary = async () => {
    if (!user?.id) { showToast('Sign in to join groups'); return; }
    if (joinState === 'join') {
      setJoinState('joined');
      await supabase.from('group_members').upsert({ group_id: groupId, user_id: user.id, role: 'member' });
    } else if (joinState === 'joined') {
      setJoinState('join');
      await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', user.id);
    } else if (joinState === 'request') {
      setJoinState('requested');
      await supabase.from('group_members').upsert({ group_id: groupId, user_id: user.id, role: 'pending' });
    } else if (joinState === 'requested') {
      setJoinState('request');
      await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', user.id);
    }
  };

  // ── primary button spec per state ───────────────────────
  const BTN = {
    joined:    { bg:'linear-gradient(135deg,#19BFFF,#0090F0)', color:'#fff', shadow:'0 8px 20px rgba(2,162,240,0.4)',    label:'Joined',             icon:'check' },
    join:      { bg:'#0E1726',                                  color:'#fff', shadow:'0 8px 20px rgba(14,23,38,0.28)',   label:'Join Group',          icon:'plus'  },
    requested: { bg:'#fff', border:`1.6px solid ${C.border}`,  color:'#7B8499', shadow:'none',                          label:'Requested · Pending', icon:null    },
    request:   { bg:'#0E1726',                                  color:'#fff', shadow:'0 8px 20px rgba(14,23,38,0.28)',   label:'Request To Join',     icon:null    },
  };
  const btn = BTN[joinState] || BTN.join;

  const GEVENTS = [
    { id:1, title:'Annual History Event',     when:'May 5 · 12:00 PM',  day:'5',  mon:'MAY',  grad:'linear-gradient(135deg,#7C5CFF,#02B6FE)', going:56  },
    { id:2, title:'Archive Walking Tour',     when:'May 18 · 2:00 PM',  day:'18', mon:'MAY',  grad:'linear-gradient(135deg,#FF5A8A,#FF8A3D)', going:24  },
    { id:3, title:'Semester Wrap Social',     when:'Apr 25 · 6:00 PM',  day:'25', mon:'APR',  grad:'linear-gradient(135deg,#10B981,#06B6D4)', going:41  },
  ];
  const GMEDIA = [
    {grad:'linear-gradient(135deg,#7C5CFF,#02B6FE)',isVideo:false},
    {grad:'linear-gradient(135deg,#FF5A8A,#FF8A3D)',isVideo:true },
    {grad:'linear-gradient(135deg,#10B981,#06B6D4)',isVideo:false},
    {grad:'linear-gradient(135deg,#2F6BFF,#6C4DF2)',isVideo:false},
    {grad:'linear-gradient(135deg,#FF6B6B,#FFB347)',isVideo:true },
    {grad:'linear-gradient(135deg,#7C5CFF,#B06BFF)',isVideo:false},
    {grad:'linear-gradient(135deg,#FF8A3D,#FF5A8A)',isVideo:false},
    {grad:'linear-gradient(135deg,#06B6D4,#0098F0)',isVideo:false},
    {grad:'linear-gradient(135deg,#10B981,#34D399)',isVideo:true },
  ];

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>

      <div style={{ flex:1, overflowY:'auto' }}>

        {/* ── Cover ───────────────────────────────────────── */}
        <div style={{ position:'relative', height:150, overflow:'hidden',
                      background:'linear-gradient(135deg,#1A1F2E 0%,#2E3548 60%,#465067 120%)' }}>
          <div style={{ position:'absolute', inset:0, background:
            'repeating-linear-gradient(135deg,rgba(255,255,255,0.06) 0,rgba(255,255,255,0.06) 2px,transparent 2px,transparent 18px)' }}/>
          <span style={{ position:'absolute', bottom:10, left:14,
                         fontFamily:"'JetBrains Mono',monospace",
                         fontSize:10, color:'rgba(255,255,255,0.7)' }}>
            GROUP COVER · placeholder
          </span>
          <button onClick={goBack} style={{ position:'absolute', top:50, left:14, width:40,
            height:40, border:'none', borderRadius:'50%',
            background:'rgba(14,23,38,0.5)', backdropFilter:'blur(8px)',
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M14 6l-6 6 6 6" stroke="#fff" strokeWidth="2.2"
                    strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button onClick={() => showToast('Mute, report, or leave this group')} style={{
            position:'absolute', top:50, right:14, width:40, height:40,
            border:'none', borderRadius:'50%', background:'rgba(14,23,38,0.5)',
            backdropFilter:'blur(8px)', display:'flex', alignItems:'center',
            justifyContent:'center', cursor:'pointer' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="5"  r="1.8" fill="#fff"/>
              <circle cx="12" cy="12" r="1.8" fill="#fff"/>
              <circle cx="12" cy="19" r="1.8" fill="#fff"/>
            </svg>
          </button>
        </div>

        {/* ── Avatar ──────────────────────────────────────── */}
        <div style={{ display:'flex', justifyContent:'center', marginTop:-42, position:'relative', zIndex:2 }}>
          <div style={{ width:84, height:84, borderRadius:'50%', border:'4px solid #F4F6FA',
                        background:g.logoColor || g.logo_color || "linear-gradient(135deg,#19BFFF,#0098F0)", display:'flex', alignItems:'center',
                        justifyContent:'center', color:'#fff', fontSize:30, fontWeight:800,
                        position:'relative', overflow:'hidden',
                        boxShadow:'0 6px 16px rgba(16,24,40,0.18)' }}>
            <span>{g.initial || (g.name || "G")[0].toUpperCase()}</span>
            <div style={{ position:'absolute', inset:0, background:
              'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 13px)' }}/>
          </div>
        </div>

        {/* ── Name + desc ─────────────────────────────────── */}
        <div style={{ padding:'11px 24px 0', textAlign:'center' }}>
          <div style={{ fontSize:22, fontWeight:800, letterSpacing:-0.5, color:C.ink }}>{g.name}</div>
          <div style={{ fontSize:13, lineHeight:1.5, color:'#7B8499', marginTop:6 }}>{g.desc || g.description || ""}</div>
        </div>

        {/* ── Stats ───────────────────────────────────────── */}
        <div style={{ display:'flex', justifyContent:'center', gap:34, marginTop:16 }}>
          {[{v:g.count || g.member_count || 0,l:'Members'},{v:g.posts || g.post_count || 0,l:'Posts'},{v:g.events || g.event_count || 0,l:'Events'}].map(s => (
            <div key={s.l} style={{ textAlign:'center' }}>
              <div style={{ fontSize:18, fontWeight:800, color:C.ink }}>{s.v}</div>
              <div style={{ fontSize:12, color:C.subtle, fontWeight:600, marginTop:1 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* ── Action row ──────────────────────────────────── */}
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'18px 16px 0' }}>

          {/* Primary button */}
          <button onClick={handlePrimary} style={{
            flex:1, height:46, borderRadius:999, border:btn.border||'none',
            background:btn.bg, color:btn.color, boxShadow:btn.shadow,
            fontSize:15, fontWeight:800, cursor:'pointer',
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
                               color:'#fff', fontSize:10, fontWeight:800,
                               display:'flex', alignItems:'center', justifyContent:'center',
                               border:'2px solid #F4F6FA' }}>5</span>
              )}
            </button>
          )}

          {/* Manage (joined) */}
          {isJoined && (
            <button onClick={() => navigate('group-manage',{groupId:g.id})} style={{
              width:46, height:46, border:'none', borderRadius:'50%', flexShrink:0,
              background:C.ink, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 4px 12px rgba(14,23,38,0.2)',
            }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
                <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="#fff" strokeWidth="1.9"/>
                <path d="M19.4 13a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V19a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-.3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"
                      stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>

        {/* ── Pinned event (joined groups only) ───────────── */}
        {isJoined && (
          <div onClick={() => navigate('event-details',{eventId:1})}
            style={{ margin:'14px 16px 0', background:'#fff', borderRadius:18,
                     boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:'13px 14px',
                     display:'flex', alignItems:'center', gap:13, cursor:'pointer' }}>
            <div style={{ width:48, height:48, borderRadius:14, flexShrink:0,
                          background:'linear-gradient(135deg,#19BFFF,#0078E0)',
                          display:'flex', flexDirection:'column', alignItems:'center',
                          justifyContent:'center', color:'#fff' }}>
              <span style={{ fontSize:16, fontWeight:800, lineHeight:1 }}>5</span>
              <span style={{ fontSize:9, fontWeight:700, letterSpacing:0.5, marginTop:1 }}>MAY</span>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:800, color:C.ink }}>Annual History Event</div>
              <div style={{ fontSize:12, color:'#7B8499', marginTop:2 }}>3rd Tier · 12:00 PM</div>
              <div style={{ fontSize:12, marginTop:3 }}>
                <span style={{ color:C.primary, fontWeight:700 }}>56 going</span>
                <span style={{ color:C.subtle }}> · 24 interested</span>
              </div>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
              <path d="M12 3v12M12 3l-4 2M12 3l4 2M7 16h10l-1.5 5h-7L7 16Z"
                    stroke={C.subtle} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        )}

        {/* ══ PRIVATE VIEW ════════════════════════════════════ */}
        {isPrivate && (
          <>
            {/* Group Details card */}
            <div style={{ margin:'16px 16px 0', background:'#fff', borderRadius:18,
                          boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:16 }}>
              <div style={{ fontSize:16, fontWeight:800, color:C.ink, marginBottom:13 }}>
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
                  <span style={{ flex:1, fontSize:13.5, fontWeight:600, color:'#3A4252' }}>
                    {row.label}
                  </span>
                  <span style={{ fontSize:13, fontWeight:700, color:row.valColor }}>
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
                <span style={{ fontSize:16, fontWeight:800, color:C.ink }}>Group Rules</span>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {(g.rules || ['Be respectful','No spam','Keep it on-topic','Credit sources']).map((r,i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:9 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
                      <path d="M5 12.5l4.5 4.5L19 7" stroke="#C2493D" strokeWidth="2.4"
                            strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span style={{ fontSize:13.5, fontWeight:500, color:C.muted }}>{r}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ height:24 }}/>
          </>
        )}

        {/* ══ PUBLIC VIEW ═════════════════════════════════════ */}
        {canSee && (
          <>
            {/* Social links row */}
            <div style={{ display:'flex', justifyContent:'center', gap:20,
                          padding:'16px 0 4px' }}>
              {[
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="5" stroke="#39414F" strokeWidth="1.8"/><circle cx="12" cy="12" r="3.4" stroke="#39414F" strokeWidth="1.8"/><circle cx="16.5" cy="7.5" r="1" fill="#39414F"/></svg>,
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M14 4v9.5a3.5 3.5 0 1 1-3-3.46V13a1 1 0 1 0 1 1V4h2c.3 1.8 1.7 3.2 3.5 3.5v2c-1.3-.1-2.5-.5-3.5-1.2" stroke="#39414F" strokeWidth="1.6" strokeLinejoin="round"/></svg>,
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="#39414F" strokeWidth="1.7"/><path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" stroke="#39414F" strokeWidth="1.7"/></svg>,
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" stroke="#39414F" strokeWidth="1.7"/><path d="m4 7 8 6 8-6" stroke="#39414F" strokeWidth="1.7" strokeLinejoin="round"/></svg>,
              ].map((icon, i) => (
                <button key={i} onClick={() => showToast(['Instagram','TikTok','Website','Email'][i])}
                  style={{ width:38, height:38, borderRadius:11, background:'#fff',
                           display:'flex', alignItems:'center', justifyContent:'center',
                           border:'none', cursor:'pointer',
                           boxShadow:'0 3px 8px rgba(16,24,40,0.06)' }}>
                  {icon}
                </button>
              ))}
            </div>

            {/* Tabs */}
            <div style={{ display:'flex', gap:24, padding:'8px 18px 0',
                          borderBottom:`1px solid ${C.divider}` }}>
              {['posts','events','media','rules'].map(t => (
                <button key={t} onClick={() => setActiveTab(t)} style={{
                  border:'none', background:'none', cursor:'pointer',
                  fontFamily:"'Montserrat',-apple-system,sans-serif",
                  fontSize:14, padding:'0 0 11px', position:'relative',
                  fontWeight: t===activeTab ? 800 : 700,
                  color: t===activeTab ? C.primary : C.subtle,
                  borderBottom: t===activeTab ? `2.5px solid ${C.primary}` : '2.5px solid transparent',
                  marginBottom:-1, textTransform:'capitalize',
                }}>
                  {t.charAt(0).toUpperCase()+t.slice(1)}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ padding:'14px 16px 100px', display:'flex', flexDirection:'column', gap:14 }}>

              {/* POSTS */}
              {activeTab === 'posts' && (
                postsLoading ? (
                  <div style={{ textAlign:'center', padding:32, color:C.subtle }}>Loading posts…</div>
                ) : livePosts.length === 0 ? (
                  <div style={{ textAlign:'center', padding:32, color:C.subtle }}>No posts yet. Be the first!</div>
                ) : livePosts.map((p, i) => {
                  const pid   = p.id || `${g.id}_${i}`;
                  const liked = !!postLiked[pid];
                  const cOpen = commentsOpen === pid;
                  const cList = comments[pid] || [];
                  return (
                    <div key={i} style={{ background:'#fff', borderRadius:18,
                                          boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:15 }}>
                      {/* Author */}
                      <div style={{ display:'flex', alignItems:'center', gap:11 }}>
                        <div style={{ width:40, height:40, borderRadius:'50%', flexShrink:0,
                                      background:p.aColor, display:'flex', alignItems:'center',
                                      justifyContent:'center', color:'#fff',
                                      fontSize:14, fontWeight:800, position:'relative',
                                      overflow:'hidden' }}>
                          <span>{p.aInitial}</span>
                          <div style={{ position:'absolute', inset:0, background:
                            'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 10px)'}}/>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                            <span style={{ fontSize:14, fontWeight:800, color:C.ink }}>
                              {p.author}
                            </span>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                              <path d="M12 2.5l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.6.6 2.6-2.3 1.4-1 2.5-2.7-.2L12 21.5 9.8 19.9l-2.7.2-1-2.5-2.3-1.4.6-2.6L3.8 11l2.3-1.4 1-2.5 2.7.2L12 2.5Z"
                                    fill="#02B6FE"/>
                              <path d="m9 12 2 2 4-4.5" stroke="#fff" strokeWidth="1.8"
                                    strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                          <div style={{ fontSize:11.5, color:C.subtle, marginTop:1 }}>{p.time}</div>
                        </div>
                        <button onClick={() => showToast('Post options')} style={{
                          width:30, height:30, border:'none', background:'none',
                          cursor:'pointer', display:'flex', alignItems:'center',
                          justifyContent:'center', flexShrink:0 }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <circle cx="5"  cy="12" r="1.7" fill={C.subtle}/>
                            <circle cx="12" cy="12" r="1.7" fill={C.subtle}/>
                            <circle cx="19" cy="12" r="1.7" fill={C.subtle}/>
                          </svg>
                        </button>
                      </div>

                      {/* Reactions row */}
                      <div style={{ display:'flex', gap:7, marginTop:11 }}>
                        {[
                          <div style={{background:'#7C5CFF',display:'flex',alignItems:'center',justifyContent:'center'}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 21V11l4-6a2 2 0 0 1 3 2l-1 4h4a2 2 0 0 1 2 2.3l-1.3 6A2 2 0 0 1 20 21H9Z" fill="#fff"/></svg></div>,
                          <div style={{background:'#7C5CFF',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:15,fontWeight:800}}>?</div>,
                          <div style={{background:'#7C5CFF',display:'flex',alignItems:'center',justifyContent:'center'}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3.5V16.5H6a2 2 0 0 1-2-2Z" fill="#fff"/></svg></div>,
                        ].map((inner, ri) => (
                          <div key={ri} style={{ width:30, height:30, borderRadius:'50%',
                                                 overflow:'hidden', display:'flex',
                                                 alignItems:'center', justifyContent:'center',
                                                 background:'#7C5CFF' }}>
                            {inner}
                          </div>
                        ))}
                      </div>

                      {/* Post text */}
                      <div style={{ fontSize:15, fontWeight:800, color:C.ink,
                                    marginTop:11, lineHeight:1.35 }}>{p.text}</div>

                      {/* Image */}
                      {p.img && (
                        <div style={{ position:'relative', height:170, borderRadius:14,
                                      overflow:'hidden', marginTop:11,
                                      background:'linear-gradient(135deg,#5B6473,#8A93A6)' }}>
                          <div style={{ position:'absolute', inset:0, background:
                            'repeating-linear-gradient(135deg,rgba(255,255,255,0.08) 0,rgba(255,255,255,0.08) 2px,transparent 2px,transparent 16px)'}}/>
                          <span style={{ position:'absolute', bottom:8, left:10,
                                         fontFamily:"'JetBrains Mono',monospace",
                                         fontSize:10, color:'rgba(255,255,255,0.85)' }}>
                            POST IMAGE · placeholder
                          </span>
                        </div>
                      )}

                      {/* Like / Comment / Share */}
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:13,
                                    paddingTop:12, borderTop:`1px solid ${C.divider}` }}>
                        <button onClick={() => togglePostLike(pid)}
                          style={{ display:'flex', alignItems:'center', gap:6,
                                   border:'none', background:'none', cursor:'pointer', padding:0 }}>
                          <svg width="19" height="19" viewBox="0 0 24 24">
                            <path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7C20.5 15 12 20.5 12 20.5Z"
                                  fill={liked?'#FF3B6B':'none'}
                                  stroke={liked?'#FF3B6B':C.subtle}
                                  strokeWidth="1.8" strokeLinejoin="round"/>
                          </svg>
                          <span style={{ fontSize:13, fontWeight:700,
                                         color:liked?'#FF3B6B':'#7B8499' }}>
                            {parseInt(p.likes,10)+(liked?1:0)}
                          </span>
                        </button>
                        <button onClick={() => setCommentsOpen(cOpen?null:pid)}
                          style={{ display:'flex', alignItems:'center', gap:6, border:'none',
                                   background:'none', cursor:'pointer', padding:0, marginLeft:14 }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3.5V16.5H6a2 2 0 0 1-2-2Z"
                                  stroke={cOpen?C.primary:C.subtle} strokeWidth="1.8" strokeLinejoin="round"/>
                          </svg>
                          <span style={{ fontSize:13, fontWeight:700, color:'#7B8499' }}>
                            {parseInt(p.reactions,10)+cList.length}
                          </span>
                        </button>
                        <button onClick={() => showToast('Post shared')}
                          style={{ display:'flex', alignItems:'center', gap:6, border:'none',
                                   background:'none', cursor:'pointer', padding:0, marginLeft:'auto' }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M14 9V6.5a2 2 0 0 1 3.4-1.4l3.6 5a1.5 1.5 0 0 1 0 1.8l-3.6 5A2 2 0 0 1 14 15.5V13c-6 0-8 3-8 3s0-7 8-7Z"
                                  stroke={C.subtle} strokeWidth="1.8" strokeLinejoin="round"/>
                          </svg>
                          <span style={{ fontSize:13, fontWeight:700, color:'#7B8499' }}>Share</span>
                        </button>
                      </div>

                      {/* Inline comments */}
                      {cOpen && (
                        <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${C.divider}` }}>
                          {cList.length === 0 && (
                            <div style={{ fontSize:12, color:C.subtle, textAlign:'center',
                                          paddingBottom:8 }}>
                              No comments yet. Be the first!
                            </div>
                          )}
                          {cList.map((c,ci) => (
                            <div key={ci} style={{ display:'flex', gap:8, marginBottom:8 }}>
                              <div style={{ width:28, height:28, borderRadius:'50%',
                                            flexShrink:0, background:C.primary,
                                            display:'flex', alignItems:'center',
                                            justifyContent:'center', color:'#fff',
                                            fontSize:11, fontWeight:800 }}>Y</div>
                              <div style={{ flex:1, background:C.chip, borderRadius:12,
                                            padding:'8px 11px' }}>
                                <div style={{ fontSize:12, fontWeight:700, color:C.ink }}>{c.who}</div>
                                <div style={{ fontSize:12, color:C.body, marginTop:2 }}>{c.text}</div>
                              </div>
                            </div>
                          ))}
                          <div style={{ display:'flex', gap:8, marginTop:4 }}>
                            <div style={{ width:28, height:28, borderRadius:'50%', flexShrink:0,
                                          background:C.primary, display:'flex',
                                          alignItems:'center', justifyContent:'center',
                                          color:'#fff', fontSize:11, fontWeight:800 }}>Y</div>
                            <input value={draft} onChange={e=>setDraft(e.target.value)}
                              onKeyDown={e=>{
                                if(e.key==='Enter'&&draft.trim()){
                                  setComments(s=>({...s,[pid]:[...(s[pid]||[]),{who:'You',text:draft.trim()}]}));
                                  setDraft('');
                                }
                              }}
                              placeholder="Write a comment…"
                              style={{ flex:1, height:34, border:`1.5px solid ${C.border}`,
                                       borderRadius:999, background:'#fff', padding:'0 13px',
                                       fontSize:12, outline:'none',
                                       fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {/* EVENTS */}
              {activeTab === 'events' && (
                groupEvents.length === 0
                  ? <div style={{ textAlign:'center', padding:'32px 0', color:C.subtle, fontSize:12 }}>No upcoming events</div>
                  : groupEvents.map(ev => {
                    const d = ev.date ? new Date(ev.date) : null;
                    const day = d ? d.getDate().toString() : '';
                    const mon = d ? d.toLocaleString('en',{month:'short'}).toUpperCase() : '';
                    const grad = THEME[ev.category || ev.primary]?.grad || 'linear-gradient(135deg,#7C5CFF,#02B6FE)';
                    return (
                      <div key={ev.id} onClick={() => navigate('event-details',{eventId:ev.id})}
                        style={{ display:'flex', gap:13, background:'#fff', borderRadius:18,
                                 boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:13, cursor:'pointer', marginBottom:10 }}>
                        <div style={{ width:58, height:58, borderRadius:14, flexShrink:0,
                                      background:grad, position:'relative', overflow:'hidden',
                                      display:'flex', flexDirection:'column', alignItems:'center',
                                      justifyContent:'center', color:'#fff' }}>
                          <div style={{ position:'absolute', inset:0, background:
                            'repeating-linear-gradient(135deg,rgba(255,255,255,0.14) 0,rgba(255,255,255,0.14) 2px,transparent 2px,transparent 9px)'}}/>
                          <span style={{ position:'relative', fontSize:18, fontWeight:800, lineHeight:1 }}>{day}</span>
                          <span style={{ position:'relative', fontSize:9.5, fontWeight:700, letterSpacing:0.5, marginTop:2 }}>{mon}</span>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:14.5, fontWeight:800, color:C.ink, lineHeight:1.25 }}>{ev.title}</div>
                          <div style={{ fontSize:12, color:C.subtle, marginTop:4 }}>{ev.date || ''}</div>
                          <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:7 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                              <circle cx="9" cy="8.5" r="3" stroke={C.primary} strokeWidth="1.8"/>
                              <path d="M3.5 19c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" stroke={C.primary} strokeWidth="1.8" strokeLinecap="round"/>
                            </svg>
                            <span style={{ fontSize:11.5, fontWeight:700, color:C.primary }}>{ev.attendees_count || ev.going || 0} going</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}

              {/* MEDIA */}
              {activeTab === 'media' && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6 }}>
                  {GMEDIA.map((m,i) => (
                    <div key={i} onClick={() => showToast('Opening media…')}
                      style={{ position:'relative', aspectRatio:'1', borderRadius:10,
                               overflow:'hidden', background:m.grad, cursor:'pointer' }}>
                      <div style={{ position:'absolute', inset:0, background:
                        'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 9px)'}}/>
                      {m.isVideo && (
                        <div style={{ position:'absolute', top:'50%', left:'50%',
                                      transform:'translate(-50%,-50%)', width:30, height:30,
                                      borderRadius:'50%', background:'rgba(255,255,255,0.9)',
                                      display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path d="M8 5v14l11-7L8 5Z" fill={C.ink}/>
                          </svg>
                        </div>
                      )}
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
                                    justifyContent:'center', fontSize:13, fontWeight:800,
                                    color:C.primary }}>{i+1}</div>
                      <span style={{ flex:1, fontSize:13.5, fontWeight:600, lineHeight:1.45,
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
        <button onClick={() => navigate('create-post')} style={{
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: EVENT DETAILS
// ─────────────────────────────────────────────────────────────
function EventDetailsScreen({ eventId, liked, toggleLike, saved, toggleSave, following, toggleFollowing, navigate, goBack, showToast, role }) {
  const [dbEvent, setDbEvent] = useState(null);
  useEffect(() => {
    if (!eventId) return;
    supabase.from('events').select('*').eq('id', eventId).single()
      .then(({ data }) => { if (data) setDbEvent(data); });
  }, [eventId]);
  const ev = dbEvent || EVENTS.find(e => e.id === eventId) || EVENTS[0];
  const th = THEME[ev.primary || ev.category] || THEME.social;
  const [expanded, setExpanded] = useState(false);
  const isLiked = !!liked[ev.id], isSaved = !!saved[ev.id], isFollowing = !!following[ev.id];

  const attendeeCount = ev.attendee_count || ev.attendees || 0;
  const evTags = Array.isArray(ev.tags) ? ev.tags : [];
  const similar = EVENTS.filter(e => e.id !== ev.id && Array.isArray(e.tags) && e.tags.some(t => evTags.includes(t))).slice(0,2);

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
        <div style={{ flex:1, textAlign:'center', fontSize:14, fontWeight:800,
                      letterSpacing:-0.4, color:C.ink, whiteSpace:'nowrap',
                      overflow:'hidden', textOverflow:'ellipsis' }}>{ev.title}</div>
        <HeaderBtn onClick={() => showToast('Share link copied')}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <circle cx="18" cy="5.5" r="2.5" stroke="#39414F" strokeWidth="1.9"/>
            <circle cx="6" cy="12" r="2.5" stroke="#39414F" strokeWidth="1.9"/>
            <circle cx="18" cy="18.5" r="2.5" stroke="#39414F" strokeWidth="1.9"/>
            <path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1" stroke="#39414F" strokeWidth="1.9"/>
          </svg>
        </HeaderBtn>
        <HeaderBtn onClick={() => toggleSave(ev.id)}>
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z"
                  fill={isSaved ? C.primary : 'rgba(0,0,0,0)'}
                  stroke={isSaved ? C.primary : '#39414F'} strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
        </HeaderBtn>
        <HeaderBtn onClick={() => toggleLike(ev.id)}>
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
                            background:'rgba(255,255,255,0.92)', fontSize:10, fontWeight:700, color:C.body }}>
                {th.label} · Event
              </div>
              <div style={{ position:'absolute', bottom:14, left:14, right:14 }}>
                <div style={{ fontSize:20, fontWeight:800, color:'#fff', letterSpacing:-0.5,
                              lineHeight:1.2, textShadow:'0 1px 6px rgba(0,0,0,0.5)' }}>{ev.title}</div>
              </div>
              {ev.badge && (
                <div style={{ position:'absolute', top:12, right:12, display:'inline-flex',
                              alignItems:'center', height:24, padding:'0 10px', borderRadius:7,
                              background:'rgba(14,23,38,0.55)', fontSize:10, fontWeight:700, color:'#fff' }}>
                  {ev.badge}
                </div>
              )}
            </div>
          );
        })()}

        {/* Organizer card */}
        <div style={{ marginTop:13, background:C.card, borderRadius:16,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:'12px 15px',
                      display:'flex', alignItems:'center', gap:11 }}>
          <div style={{ width:44, height:44, borderRadius:13, flexShrink:0,
                        background:th.grad, display:'flex', alignItems:'center',
                        justifyContent:'center', color:'#fff', fontSize:14, fontWeight:800 }}>
            {ev.orgInitial}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ fontSize:14, fontWeight:800, color:C.ink }}>{ev.org}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 2.5l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.6.6 2.6-2.3 1.4-1 2.5-2.7-.2L12 21.5 9.8 19.9l-2.7.2-1-2.5-2.3-1.4.6-2.6L3.8 11l2.3-1.4 1-2.5 2.7.2L12 2.5Z" fill="#02B6FE"/>
                <path d="m9 12 2 2 4-4.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{ fontSize:11, color:'#8A93A6', marginTop:2 }}>Verified Organizer</div>
          </div>
          <button onClick={() => toggleFollowing(ev.id)}
            style={{ flexShrink:0, height:30, padding:'0 14px', borderRadius:999,
                     border: isFollowing ? `1.5px solid ${C.border}` : 'none',
                     background: isFollowing ? '#fff' : C.primary,
                     color: isFollowing ? '#7B8499' : '#fff',
                     fontSize:11, fontWeight:700, cursor:'pointer',
                     fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
            {isFollowing ? 'Following' : 'Follow'}
          </button>
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
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                            textTransform:'uppercase', color:C.subtle }}>Date &amp; Time</div>
              <div style={{ fontSize:13, fontWeight:700, color:C.body, marginTop:3 }}>{ev.fullDate || ev.full_date || ev.date}</div>
              <div style={{ fontSize:11, color:'#6B7385', marginTop:1 }}>{ev.timeRange || ev.time_range}</div>
              <button onClick={() => showToast('Added to your calendar')} style={{
                marginTop:8, display:'inline-flex', alignItems:'center', gap:5,
                height:28, padding:'0 11px', border:`1.5px solid ${C.border}`, background:'#fff',
                borderRadius:999, fontSize:11, fontWeight:700, color:C.primary,
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
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                            textTransform:'uppercase', color:C.subtle }}>Location</div>
              <div style={{ fontSize:13, fontWeight:700, color:C.body, marginTop:3 }}>{ev.venue}</div>
              <div style={{ fontSize:11, color:'#6B7385', marginTop:1 }}>{ev.room}</div>
              {/* Map placeholder */}
              <div style={{ position:'relative', height:88, borderRadius:11, overflow:'hidden',
                            marginTop:10, background:'linear-gradient(135deg,#DCE7F0,#EDF2F7)' }}>
                <div style={{ position:'absolute', inset:0, background:
                  'repeating-linear-gradient(0deg,rgba(150,165,185,0.18) 0,rgba(150,165,185,0.18) 1px,transparent 1px,transparent 22px),repeating-linear-gradient(90deg,rgba(150,165,185,0.18) 0,rgba(150,165,185,0.18) 1px,transparent 1px,transparent 22px)' }}/>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                  style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-58%)' }}>
                  <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" fill={C.primary}/>
                  <circle cx="12" cy="10" r="2.6" fill="#fff"/>
                </svg>
                <span style={{ position:'absolute', bottom:7, left:9,
                               fontFamily:"'JetBrains Mono',monospace",
                               fontSize:9, color:'#7B8499' }}>MAP · placeholder</span>
              </div>
              <div style={{ display:'flex', gap:8, marginTop:9 }}>
                <button onClick={() => showToast('Opening venue on map')} style={{
                  flex:1, height:32, border:`1.5px solid ${C.border}`, background:'#fff',
                  borderRadius:9, fontSize:11.5, fontWeight:700, color:C.body,
                  cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
                }}>View on Map</button>
                <button onClick={() => showToast('Getting directions')} style={{
                  flex:1, height:32, border:'none', background:'#E9F6FF',
                  borderRadius:9, fontSize:11.5, fontWeight:700, color:C.primary,
                  cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
                }}>Get Directions</button>
              </div>
            </div>
          </div>

          {/* Price */}
          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 0' }}>
            <div style={{ width:36, height:36, borderRadius:10, flexShrink:0, background:'#E6F8F0',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M7 7h10M7 12h7M11 17l-4-2 4-2" stroke="#10B981" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="12" r="9" stroke="#10B981" strokeWidth="1.9"/>
              </svg>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                            textTransform:'uppercase', color:C.subtle }}>Price</div>
              <div style={{ fontSize:13, fontWeight:800, color:'#10B981', marginTop:3 }}>
                {ev.price === 'Free' || ev.price === 0 ? 'Free for students' : ev.price}
              </div>
            </div>
            <span style={{ fontSize:10, fontWeight:800, color:'#0E9F6E',
                           background:'#E6F8F0', padding:'4px 10px', borderRadius:999 }}>
              Spots open
            </span>
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
            <span style={{ fontSize:14, fontWeight:800, color:C.ink }}>About This Event</span>
          </div>
          <div style={{ fontSize:12.5, lineHeight:1.65, color:C.muted }}>
            {expanded ? (ev.fullDesc || ev.full_desc || ev.description) : (ev.desc || ev.description)}
          </div>
          <button onClick={() => setExpanded(e => !e)} style={{ marginTop:8, border:'none',
            background:'none', padding:0, fontSize:12, fontWeight:800, color:C.primary,
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
            <span style={{ fontSize:14, fontWeight:800, color:C.ink }}>Rules &amp; Guidelines</span>
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
                <span style={{ fontSize:12, fontWeight:600, color:'#3A4252' }}>{r}</span>
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
              <span style={{ fontSize:14, fontWeight:800, color:C.ink }}>Attending</span>
            </div>
            <div style={{ fontSize:12, color:'#6B7385' }}>
              <span style={{ fontWeight:800, color:C.body }}>{attendeeCount} attending</span>
            </div>
          </div>
        )}

        {/* Guest Speakers — only shown if event has guests */}
        {Array.isArray(ev.guests) && ev.guests.length > 0 && (
          <div style={{ marginTop:16 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                          padding:'0 2px 10px' }}>
              <span style={{ fontSize:14, fontWeight:800, color:C.ink }}>Guest Speakers</span>
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
                      <span style={{ fontSize:22, fontWeight:800, color:'#fff' }}>
                        {(g.name || '?')[0].toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize:12, fontWeight:800, color:C.ink, marginTop:8,
                                  whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {g.name}
                    </div>
                    {g.role && (
                      <div style={{ fontSize:10, color:'#8A93A6', marginTop:2, whiteSpace:'nowrap',
                                    overflow:'hidden', textOverflow:'ellipsis' }}>{g.role}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* You may also like */}
        {similar.length > 0 && (
          <div style={{ marginTop:18 }}>
            <div style={{ fontSize:14, fontWeight:800, color:C.ink, marginBottom:11 }}>
              You May Also Like
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {similar.map(e2 => (
                <div key={e2.id} onClick={() => navigate('event-details', {eventId:e2.id})}
                  style={{ display:'flex', gap:11, background:C.card, borderRadius:14,
                           boxShadow:'0 4px 14px rgba(16,24,40,0.06)', padding:10,
                           cursor:'pointer' }}>
                  <div style={{ width:68, height:68, borderRadius:11, flexShrink:0,
                                background:(THEME[e2.primary]||THEME.social).grad,
                                position:'relative', overflow:'hidden' }}>
                    <div style={{ position:'absolute', inset:0, background:
                      'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 13px)'}}/>
                  </div>
                  <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column',
                                justifyContent:'center' }}>
                    <span style={{ fontSize:9, fontWeight:700, color:C.primary,
                                   background:'#E9F6FF', padding:'2px 7px', borderRadius:999,
                                   alignSelf:'flex-start' }}>
                      {(THEME[e2.primary]||THEME.social).label}
                    </span>
                    <div style={{ fontSize:13, fontWeight:800, color:C.ink, marginTop:4,
                                  whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {e2.title}
                    </div>
                    <div style={{ fontSize:11, color:'#8A93A6', marginTop:2 }}>{e2.date}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky buy bar ───────────────────────────────── */}
      <div style={{ position:'absolute', bottom:0, left:0, right:0, zIndex:6,
                    background:'rgba(255,255,255,0.96)', backdropFilter:'blur(16px)',
                    boxShadow:'0 -1px 0 rgba(16,24,40,0.07)', padding:'12px 16px 26px',
                    display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ flexShrink:0 }}>
          <div style={{ fontSize:10, color:C.subtle, fontWeight:600 }}>Price</div>
          <div style={{ fontSize:16, fontWeight:800, color:C.ink }}>{ev.price}</div>
        </div>
        {role !== 'student' ? (
          <button onClick={() => navigate('check-in', {eventId: ev.id})} style={{
            flex:1, height:50, border:'none', borderRadius:15, cursor:'pointer',
            background:'linear-gradient(135deg,#0E1726,#1A2538)', color:'#fff',
            fontSize:13, fontWeight:800,
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            boxShadow:'0 8px 20px rgba(14,23,38,0.3)',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Check In
          </button>
        ) : (
          <button onClick={() => navigate('tickets', {eventId: ev.id})} style={{
            flex:1, height:50, border:'none', borderRadius:15, cursor:'pointer',
            background:C.grad, color:'#fff', fontSize:14, fontWeight:800,
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            boxShadow:'0 8px 20px rgba(2,162,240,0.4)',
          }}>
            {ev.price === 'Free' || ev.price === 0 ? 'Reserve Spot' : 'Buy Ticket'}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h13M13 6l6 6-6 6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: SPACE DETAILS
// ─────────────────────────────────────────────────────────────
function SpaceDetailsScreen({ spaceId, goBack, navigate, showToast }) {
  const { user } = useUser();
  const [dbSpace, setDbSpace] = useState(null);
  useEffect(() => {
    if (!spaceId) return;
    supabase.from('spaces').select('*').eq('id', spaceId).single()
      .then(({ data }) => { if (data) setDbSpace(data); });
  }, [spaceId]);
  const sp = dbSpace || SPACES.find(s => s.id === spaceId) || null;
  const [joined,   setJoined]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [liked,    setLiked]    = useState(false);
  const [followed, setFollowed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [progress, setProgress] = useState(0);

  // Animate live progress bar
  useEffect(() => {
    if (!sp?.started) return;
    const t = setInterval(() => setProgress(p => Math.min(100, p + 1)), 700);
    return () => clearInterval(t);
  }, [sp?.started]);

  if (!sp) return (
    <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      <div style={{ fontSize:13, color:C.subtle }}>Loading space…</div>
    </div>
  );

  const count = (sp.participants || 0) + (joined ? 1 : 0);
  const maxSpots = sp.max_spots || sp.max || 10;
  const isFull = count >= maxSpots;
  const pct = Math.round((count / maxSpots) * 100);
  const done = progress >= 100;

  const PARTICIPANTS = [
    {i:'A',c:'#FF5A8A'},{i:'J',c:'#0098F0'},{i:'M',c:'#10B981'},
    {i:'R',c:'#7C5CFF'},{i:'K',c:'#FF8A3D'},{i:'T',c:'#06B6D4'},
  ];

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
  const [moreOpen, setMoreOpen] = useState(false);

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
        <div style={{ flex:1, textAlign:'center', fontSize:14, fontWeight:800,
                      letterSpacing:-0.4, color:C.ink, whiteSpace:'nowrap',
                      overflow:'hidden', textOverflow:'ellipsis' }}>{sp.title}</div>
        <HeaderBtn onClick={() => showToast('Share link copied')}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <circle cx="18" cy="5.5" r="2.5" stroke="#39414F" strokeWidth="1.9"/>
            <circle cx="6" cy="12" r="2.5" stroke="#39414F" strokeWidth="1.9"/>
            <circle cx="18" cy="18.5" r="2.5" stroke="#39414F" strokeWidth="1.9"/>
            <path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1" stroke="#39414F" strokeWidth="1.9"/>
          </svg>
        </HeaderBtn>
        <HeaderBtn onClick={() => setSaved(v => !v)}>
          <svg width="16" height="16" viewBox="0 0 24 24">
            <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4-7 4V4.5a1 1 0 0 1 1-1Z"
                  fill={saved ? C.primary : 'rgba(0,0,0,0)'}
                  stroke={saved ? C.primary : '#39414F'} strokeWidth="1.8" strokeLinejoin="round"/>
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
                        background:'rgba(255,255,255,0.92)', fontSize:10, fontWeight:700, color:C.body }}>
            {spCat.charAt(0).toUpperCase()+spCat.slice(1)} · Space
          </div>
          <div style={{ position:'absolute', top:'50%', left:'50%',
                        transform:'translate(-50%,-50%)', textAlign:'center' }}>
            <div style={{ fontSize:22, fontWeight:800, color:'#fff', letterSpacing:-0.5,
                          maxWidth:280, lineHeight:1.2, textShadow:'0 2px 8px rgba(0,0,0,0.25)' }}>{sp.title}</div>
          </div>
          <div style={{ position:'absolute', bottom:12, right:12, display:'inline-flex',
                        alignItems:'center', height:24, padding:'0 10px', borderRadius:7,
                        background:'rgba(14,23,38,0.55)', fontSize:10, fontWeight:700, color:'#fff' }}>
            {sp.time}{sp.duration ? ` · ${fmtDur(sp.duration)}` : ''}
          </div>
        </div>

        {/* Host card */}
        <div style={{ marginTop:13, background:C.card, borderRadius:16,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:'12px 15px',
                      display:'flex', alignItems:'center', gap:11, position:'relative' }}>
          <div style={{ width:44, height:44, borderRadius:'50%', flexShrink:0,
                        background:sp.avatarColor || sp.avatar_color || "linear-gradient(135deg,#19BFFF,#0098F0)", display:'flex', alignItems:'center',
                        justifyContent:'center', color:'#fff', fontSize:16, fontWeight:800 }}>
            {sp.avatarInitial || sp.avatar_initial || "S"}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:800, color:C.ink }}>{hostName || 'Organizer'}</div>
            <div style={{ fontSize:11, color:'#8A93A6', marginTop:2 }}>Student</div>
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
                <button onClick={() => { setMoreOpen(false); navigate('messages'); }} style={{
                  width:'100%', padding:'12px 16px', border:'none', background:'none',
                  textAlign:'left', fontSize:13, fontWeight:700, color:C.body,
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
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                            textTransform:'uppercase', color:C.subtle }}>Participants</div>
              <div style={{ fontSize:22, fontWeight:800, marginTop:3, lineHeight:1,
                            color: isFull ? '#FF3B6B' : C.ink }}>
                {count}/{sp.max_spots || sp.max || 10}{' '}
                <span style={{ fontSize:13, fontWeight:700, color:C.subtle }}>spots filled</span>
              </div>
            </div>
            <span style={{ fontSize:10, fontWeight:800, padding:'4px 10px', borderRadius:999,
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
            {PARTICIPANTS.slice(0, count > 6 ? 6 : count).map((p, i) => (
              <div key={i} style={{ width:30, height:30, borderRadius:'50%',
                                    marginLeft: i > 0 ? -8 : 0, border:'2.5px solid #fff',
                                    flexShrink:0, display:'flex', alignItems:'center',
                                    justifyContent:'center', color:'#fff', fontSize:10,
                                    fontWeight:800, background:p.c }}>{p.i}</div>
            ))}
            {count > 6 && (
              <div style={{ width:30, height:30, borderRadius:'50%', marginLeft:-8,
                            border:'2.5px solid #fff', flexShrink:0, display:'flex',
                            alignItems:'center', justifyContent:'center',
                            background:C.chip, color:C.muted, fontSize:9, fontWeight:800 }}>
                +{count - 6}
              </div>
            )}
            <span style={{ fontSize:12, color:'#6B7385', marginLeft:10 }}>
              <span style={{ fontWeight:800, color:C.body }}>{count} joined</span>
              {' '}· {sp.max_spots || sp.max || 10 - count > 0 ? `${sp.max_spots || sp.max || 10 - count} spots left` : 'full'}
            </span>
          </div>

          {/* Live progress bar (only if session started) */}
          {sp.started && (
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
                  <span style={{ fontSize:11, fontWeight:800, color:'#10B981', letterSpacing:0.2 }}>
                    {done ? 'ENDED' : 'IN PROGRESS'}
                  </span>
                </div>
                <span style={{ fontSize:11, fontWeight:700, color:C.subtle }}>
                  {done ? 'Completed' : (sp.endTime ? `Ends ${sp.endTime}` : `${progress}%`)}
                </span>
              </div>
              <div style={{ position:'relative', height:8, borderRadius:999, background:'#EAEDF2' }}>
                <div style={{ position:'absolute', left:0, top:0, bottom:0, borderRadius:999,
                              background:'linear-gradient(90deg,#34D399,#10B981)',
                              width:`${progress}%`, transition:'width .7s linear' }}/>
                <div style={{ position:'absolute', top:'50%', transform:'translate(-50%,-50%)',
                              left:`${progress}%`, width:14, height:14, borderRadius:'50%',
                              background:'#fff', border:'3px solid #10B981',
                              boxShadow:'0 2px 5px rgba(16,185,129,0.4)',
                              transition:'left .7s linear' }}/>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:7 }}>
                <span style={{ fontSize:10, fontWeight:600, color:C.subtle }}>Started {sp.time}</span>
                <span style={{ fontSize:10, fontWeight:600, color:C.subtle }}>
                  {sp.endTime ? `Ends ${sp.endTime}` : `${sp.duration}`}
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
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                            textTransform:'uppercase', color:C.subtle }}>Schedule</div>
              <div style={{ fontSize:13, fontWeight:700, color:C.body, marginTop:3 }}>
                {sp.day === 'today' ? "Today" : "Tomorrow"} · {sp.time}
              </div>
              <div style={{ fontSize:11, color:'#6B7385', marginTop:1 }}>{fmtDur(sp.duration)} session</div>
              <button onClick={() => showToast('Added to your calendar')} style={{
                marginTop:8, display:'inline-flex', alignItems:'center', gap:5,
                height:28, padding:'0 11px', border:`1.5px solid ${C.border}`, background:'#fff',
                borderRadius:999, fontSize:11, fontWeight:700, color:C.primary,
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
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                            textTransform:'uppercase', color:C.subtle }}>Location</div>
              <div style={{ fontSize:13, fontWeight:700, color:C.body, marginTop:3 }}>
                {sp.location}
              </div>
              {/* Map placeholder */}
              <div style={{ position:'relative', height:80, borderRadius:11, overflow:'hidden',
                            marginTop:10, background:'linear-gradient(135deg,#DCE7F0,#EDF2F7)' }}>
                <div style={{ position:'absolute', inset:0, background:
                  'repeating-linear-gradient(0deg,rgba(150,165,185,0.18) 0,rgba(150,165,185,0.18) 1px,transparent 1px,transparent 22px),repeating-linear-gradient(90deg,rgba(150,165,185,0.18) 0,rgba(150,165,185,0.18) 1px,transparent 1px,transparent 22px)'}}/>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                  style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-58%)' }}>
                  <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" fill={C.primary}/>
                  <circle cx="12" cy="10" r="2.6" fill="#fff"/>
                </svg>
                <span style={{ position:'absolute', bottom:7, left:9,
                               fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'#7B8499' }}>
                  MAP · placeholder
                </span>
              </div>
              <div style={{ display:'flex', gap:8, marginTop:9 }}>
                <button onClick={() => showToast('Opening map…')} style={{
                  flex:1, height:32, border:`1.5px solid ${C.border}`, background:'#fff',
                  borderRadius:9, fontSize:11, fontWeight:700, color:C.body,
                  cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
                }}>View on Map</button>
                <button onClick={() => showToast('Getting directions…')} style={{
                  flex:1, height:32, border:'none', background:'#E9F6FF',
                  borderRadius:9, fontSize:11, fontWeight:700, color:C.primary,
                  cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
                }}>Get Directions</button>
              </div>
            </div>
          </div>

          {/* Price */}
          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 0' }}>
            <div style={{ width:36, height:36, borderRadius:10, flexShrink:0, background:'#E6F8F0',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M7 7h10M7 12h7M11 17l-4-2 4-2" stroke="#10B981" strokeWidth="1.9"
                      strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="12" r="9" stroke="#10B981" strokeWidth="1.9"/>
              </svg>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                            textTransform:'uppercase', color:C.subtle }}>Price</div>
              <div style={{ fontSize:13, fontWeight:800, color:C.ink, marginTop:3 }}>
                {spPrice}
                {spPrice !== 'Free' && <span style={{ fontSize:11, fontWeight:600, color:C.subtle }}> per session</span>}
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
            <span style={{ fontSize:14, fontWeight:800, color:C.ink }}>About This Space</span>
          </div>
          <div style={{ fontSize:12.5, lineHeight:1.65, color:C.muted }}>
            {expanded ? ABOUT_FULL : ABOUT_SHORT}
          </div>
          <button onClick={() => setExpanded(e => !e)} style={{ marginTop:8, border:'none',
            background:'none', padding:0, fontSize:12, fontWeight:800, color:C.primary,
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
            <span style={{ fontSize:14, fontWeight:800, color:C.ink }}>Rules &amp; Guidelines</span>
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
                <span style={{ fontSize:12, fontWeight:600, color:'#3A4252' }}>{r}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* ── Sticky join/joined bar ────────────────────────── */}
      <div style={{ position:'absolute', bottom:0, left:0, right:0, zIndex:6,
                    background:'rgba(255,255,255,0.96)', backdropFilter:'blur(16px)',
                    boxShadow:'0 -1px 0 rgba(16,24,40,0.07)', padding:'12px 16px 26px',
                    display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ flexShrink:0 }}>
          <div style={{ fontSize:10, color:C.subtle, fontWeight:600 }}>Price</div>
          <div style={{ fontSize:16, fontWeight:800, color:C.ink }}>
            {spPrice}
          </div>
        </div>
        {isFull && !joined ? (
          <button onClick={() => showToast("You'll be notified when a spot opens")} style={{
            flex:1, height:50, border:'none', borderRadius:15, cursor:'pointer',
            background:C.subtle, color:'#fff', fontSize:14, fontWeight:800,
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:8,
          }}>
            Notify When a Spot Opens
          </button>
        ) : (
          <button onClick={async () => {
            const next = !joined;
            setJoined(next);
            const isUuid = typeof sp.id === 'string' && sp.id.includes('-');
            if (user?.id && isUuid) {
              if (next) await supabase.from('space_participants').upsert({ space_id: sp.id, user_id: user.id });
              else await supabase.from('space_participants').delete().eq('space_id', sp.id).eq('user_id', user.id);
            }
          }} style={{
            flex:1, height:50, borderRadius:15, cursor:'pointer',
            border: joined ? `1.6px solid #10B981` : 'none',
            background: joined ? '#E6F8F0' : C.grad,
            color: joined ? '#0E9F6E' : '#fff',
            fontSize:14, fontWeight:800,
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            boxShadow: joined ? 'none' : '0 8px 20px rgba(2,162,240,0.4)',
          }}>
            {joined ? "You're In · Joined ✓" : 'Join Space'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: CHAT
// ─────────────────────────────────────────────────────────────
function ChatScreen({ chatId, goBack, showToast, currentUser }) {
  const chat = CHATS.find(c => c.id === chatId) || CHATS[0];

  const { messages: rawMessages, sendMessage, currentUserId } = useChat(chatId)
  const [draft,    setDraft]    = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef  = useRef(null);
  const inputRef   = useRef(null);

  // Map Supabase shape → UI shape
  const messages = rawMessages.map(msg => ({
    id:      msg.id,
    side:    msg.sender_id === currentUserId ? 'out' : 'in',
    text:    msg.content,
    time:    new Date(msg.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }),
    hasText: true,
    sender:  msg.sender_id,
    aInitial: msg.sender_id?.[0]?.toUpperCase() || '?',
    aColor:  'linear-gradient(135deg,#7C5CFF,#02B6FE)',
  }))

  const scrollToBottom = () => {
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, 40);
  };

  const send = async () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    await sendMessage(t);
  };

  // Auto-scroll when messages change
  useEffect(() => { scrollToBottom(); }, [rawMessages]);

  // Online status — group chats (id 4) show member count, DMs show 'Active recently'
  const isGroup = chat.type === 'group' || chat.isGroup;
  const memberCount = chat.memberCount || chat.members;
  const onlineLabel = isGroup
    ? memberCount ? `Online · ${memberCount} members` : 'Online'
    : 'Active recently';

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

        {/* Avatar */}
        <div style={{ width:40, height:40, borderRadius:'50%', flexShrink:0,
                      background:chat.color, display:'flex', alignItems:'center',
                      justifyContent:'center', color:'#fff', fontSize:13, fontWeight:800,
                      position:'relative', overflow:'hidden' }}>
          <span>{chat.initial}</span>
          <div style={{ position:'absolute', inset:0, background:
            'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 11px)' }}/>
          {/* online dot */}
          <div style={{ position:'absolute', bottom:1, right:1, width:9, height:9,
                        borderRadius:'50%', background:'#10B981',
                        border:'2px solid #fff' }}/>
        </div>

        {/* Name + status */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:800, letterSpacing:-0.3, color:C.ink,
                        whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {chat.name}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:1 }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:'#10B981',
                           display:'inline-block', flexShrink:0 }}/>
            <span style={{ fontSize:11, fontWeight:600, color:'#10B981' }}>{onlineLabel}</span>
          </div>
        </div>

        {/* Action icons */}
        <button onClick={() => showToast('Voice call')} style={{ width:36, height:36, border:'none',
          background:'none', display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1A19.5 19.5 0 0 1 5.6 13a19.8 19.8 0 0 1-3.1-8.7 2 2 0 0 1 2-2.2h3a1 1 0 0 1 1 .9 12.8 12.8 0 0 0 .7 2.8 1 1 0 0 1-.2 1.1L7.6 8.3a16 16 0 0 0 6 6l1.4-1.4a1 1 0 0 1 1.1-.2 12.8 12.8 0 0 0 2.8.7 1 1 0 0 1 .9 1.1Z"
                  stroke="#39414F" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
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
                style={{ padding:'13px 16px', fontSize:13, fontWeight:600,
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
                      fontSize:10, fontWeight:700, color:'#7B8499' }}>
          Today
        </div>

        {messages.map((m, i) => {
          const isOut = m.side === 'out';
          const prev  = messages[i - 1];
          const firstOfGroup = !prev || prev.side !== m.side;

          return (
            <div key={m.id} style={{ display:'flex', gap:7, marginTop: firstOfGroup ? 10 : 2,
                                      flexDirection: isOut ? 'row-reverse' : 'row' }}>
              {/* Avatar — only first of incoming group */}
              {!isOut && firstOfGroup && (
                <div style={{ width:28, height:28, borderRadius:'50%', flexShrink:0,
                              background:m.aColor, display:'flex', alignItems:'center',
                              justifyContent:'center', color:'#fff', fontSize:10,
                              fontWeight:800, alignSelf:'flex-end', position:'relative',
                              overflow:'hidden' }}>
                  <span>{m.aInitial}</span>
                  <div style={{ position:'absolute', inset:0, background:
                    'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 10px)' }}/>
                </div>
              )}
              {/* Spacer for subsequent messages in group */}
              {!isOut && !firstOfGroup && <div style={{ width:28, flexShrink:0 }}/>}

              <div style={{ display:'flex', flexDirection:'column', maxWidth:'74%',
                            alignItems: isOut ? 'flex-end' : 'flex-start' }}>
                {/* Sender name */}
                {!isOut && firstOfGroup && (
                  <span style={{ fontSize:10, fontWeight:700, color:'#8A93A6',
                                 marginBottom:3, marginLeft:4 }}>{m.sender}</span>
                )}

                {/* Bubble */}
                <div style={{
                  background: isOut ? 'linear-gradient(135deg,#19BFFF,#0090F0)' : '#fff',
                  padding:'9px 13px',
                  borderRadius: isOut ? '17px 17px 4px 17px' : '17px 17px 17px 4px',
                  boxShadow: isOut
                    ? '0 3px 10px rgba(2,162,240,0.28)'
                    : '0 2px 8px rgba(16,24,40,0.07)',
                }}>
                  {/* Image preview */}
                  {m.hasImage && (
                    <div style={{ height:118, borderRadius:11, overflow:'hidden',
                                  marginBottom: m.hasText ? 7 : 0,
                                  background:'linear-gradient(135deg,#4A7C3A,#6BA84F)',
                                  position:'relative' }}>
                      <div style={{ position:'absolute', inset:0, background:
                        'repeating-linear-gradient(0deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 1px,transparent 1px,transparent 20px),repeating-linear-gradient(90deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 1px,transparent 1px,transparent 20px)' }}/>
                      <span style={{ position:'absolute', bottom:7, left:9,
                                     fontFamily:"'JetBrains Mono',monospace",
                                     fontSize:8, color:'rgba(255,255,255,0.85)' }}>
                        IMAGE · placeholder
                      </span>
                    </div>
                  )}
                  {/* Text */}
                  {m.hasText && (
                    <span style={{ fontSize:13, lineHeight:1.47,
                                   color: isOut ? '#fff' : '#1A2233' }}>
                      {m.text}
                    </span>
                  )}
                </div>

                {/* Timestamp */}
                <span style={{ fontSize:9.5, color:C.subtle, fontWeight:600,
                               marginTop:4, marginLeft:4,
                               alignSelf: isOut ? 'flex-end' : 'flex-start' }}>
                  {m.time}
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
                    padding:'10px 13px 26px', display:'flex',
                    alignItems:'center', gap:9, zIndex:6 }}>
        {/* Attach */}
        <button onClick={() => showToast('Attach a file')} style={{ width:36, height:36,
          border:'none', background:'none', display:'flex', alignItems:'center',
          justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M20 11.5 12.5 19a4.5 4.5 0 0 1-6.4-6.4l7.6-7.6a3 3 0 0 1 4.3 4.3l-7.6 7.6a1.5 1.5 0 0 1-2.2-2.2l6.9-6.9"
                  stroke="#7B8499" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Input pill */}
        <div style={{ flex:1, display:'flex', alignItems:'center', background:C.chip,
                      borderRadius:999, padding:'0 5px 0 15px', height:44,
                      boxShadow:'inset 0 0 0 1px rgba(16,24,40,0.04)' }}>
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
            placeholder="Type a message…"
            style={{ flex:1, minWidth:0, border:'none', background:'none', outline:'none',
                     fontFamily:"'Montserrat',-apple-system,sans-serif",
                     fontSize:13, color:C.body }}
          />
          {/* Emoji */}
          <button onClick={() => setDraft(d => d + '😄')} style={{ width:32, height:32,
            border:'none', background:'none', display:'flex', alignItems:'center',
            justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="#8A93A6" strokeWidth="1.8"/>
              <path d="M8.5 14.5s1.2 1.8 3.5 1.8 3.5-1.8 3.5-1.8"
                    stroke="#8A93A6" strokeWidth="1.8" strokeLinecap="round"/>
              <circle cx="9"  cy="10" r="1" fill="#8A93A6"/>
              <circle cx="15" cy="10" r="1" fill="#8A93A6"/>
            </svg>
          </button>
        </div>

        {/* Send / mic toggle */}
        {draft.trim() ? (
          <button onClick={send} style={{ width:44, height:44, border:'none', borderRadius:'50%',
            background:C.grad, display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', flexShrink:0, boxShadow:'0 4px 12px rgba(2,162,240,0.4)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M22 2 11 13" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M22 2 15 22l-4-9-9-4 20-7Z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        ) : (
          <button onClick={() => showToast('Hold to record')} style={{ width:44, height:44,
            border:'none', borderRadius:'50%', background:C.chip, display:'flex',
            alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="2" width="6" height="11" rx="3" stroke="#7B8499" strokeWidth="1.9"/>
              <path d="M5 10a7 7 0 0 0 14 0" stroke="#7B8499" strokeWidth="1.9" strokeLinecap="round"/>
              <path d="M12 19v3M9 22h6" stroke="#7B8499" strokeWidth="1.9" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>
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

  const inputStyle = { width:'100%', boxSizing:'border-box', height:48, border:`1.5px solid ${borderColor}`, borderRadius:14, background:chipBg, padding:'0 14px', fontSize:13, fontWeight:700, color:textColor, outline:'none', fontFamily:"'Montserrat',-apple-system,sans-serif" };
  const labelStyle = { fontSize:9, fontWeight:700, letterSpacing:0.4, textTransform:'uppercase', color:subColor, marginBottom:7 };

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
      <button onClick={handleUpdate} disabled={loading} style={{ width:'100%', height:52, marginTop:6, border:'none', borderRadius:15, background: loading ? C.border : C.grad, color:'#fff', fontSize:14, fontWeight:800, cursor: loading ? 'default' : 'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", boxShadow: loading ? 'none' : '0 8px 20px rgba(2,162,240,0.4)' }}>
        {loading ? 'Updating…' : 'Update Password'}
      </button>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: PROFILE
// ─────────────────────────────────────────────────────────────
function ProfileScreen({ navigate, showToast, currentUser }) {
  const cu = currentUser || {};
  const [editOpen, setEditOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [push, setPush] = useState(true);
  const [emailNotif, setEmailNotif] = useState(false);
  const [reminders, setReminders] = useState(true);
  const [location, setLocation] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [privateProfile, setPrivateProfile] = useState(false);
  const [lang, setLang] = useState('English');
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({ events: 0, groups: 0 });

  useEffect(() => {
    if (!cu?.userId) return;
    Promise.all([
      supabase.from('event_rsvps').select('event_id', { count: 'exact', head: true }).eq('user_id', cu.userId),
      supabase.from('group_members').select('group_id', { count: 'exact', head: true }).eq('user_id', cu.userId),
    ]).then(([rsvps, grps]) => {
      setStats({ events: rsvps.count || 0, groups: grps.count || 0 });
    });
  }, [cu?.userId]);

  const name = cu.name || 'Student';
  const email = cu.email || '';
  const [profileRole, setProfileRole] = useState(cu.role || 'student');
  const [draftName, setDraftName] = useState('');
  const [draftEmail, setDraftEmail] = useState('');

  const pageBg = darkMode?'#0E1726':C.pageBg;
  const cardBg = darkMode?'#1A2233':C.card;
  const textColor = darkMode?'#F4F6FA':C.ink;
  const subColor = darkMode?'#9AA3B2':C.muted;
  const chipBg = darkMode?'#2A3347':C.chip;
  const borderColor = darkMode?'#2A3347':C.border;
  const iconStroke = darkMode?'#9AA3B2':'#39414F';

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
        { icon:'#E9F6FF', iconStroke:C.primary, iconPath:'M5 19h3l9-9-3-3-9 9v3Z', iconPath2:'m14.5 6.5 3 3', title:'Edit Profile', hasChevron:true, onClick:()=>{ setDraftName(currentUser.name); setDraftEmail(currentUser.email); setEditOpen(true); } },
        { icon:'#FFF6E9', iconStroke:'#F59E0B', iconPath:'M4 8.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 1.8 1.8 0 0 0 0 3.4 1.8 1.8 0 0 0 0 3.6 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 1.8 1.8 0 0 0 0-3.6 1.8 1.8 0 0 0 0-3.4Z', title:'My Tickets', hasChevron:true, onClick:()=>navigate('my-tickets') },
        { icon:'#F1ECFF', iconStroke:'#7C5CFF', iconPath:'M3 11l1.5-7L18 9l-7 2.5L9 21', title:'Payment Methods', hasChevron:true, onClick:()=>showToast('Payment Methods coming soon') },
        ...(profileRole!=='student'?[{ icon:'#E9F6FF', iconStroke:C.primary, iconPath:'M3 5h18M3 10h18M3 15h10', title:'Manage Events', hasChevron:true, onClick:()=>navigate('event-manager') }]:[]),
      ],
    },
    {
      title:'Preferences',
      rows: [
        { icon:'#E9F6FF', iconStroke:C.primary, iconPath:'M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5Z', title:'Push Notifications', isToggle:true, toggleVal:push, onToggle:()=>setPush(v=>!v) },
        { icon:'#E4F7EC', iconStroke:'#15A34A', iconPath:'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z', iconPath2:'m22 6-10 7L2 6', title:'Email Notifications', isToggle:true, toggleVal:emailNotif, onToggle:()=>setEmailNotif(v=>!v) },
        { icon:'#FFF6E9', iconStroke:'#F59E0B', iconPath:'M12 2L15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z', title:'Reminders', isToggle:true, toggleVal:reminders, onToggle:()=>setReminders(v=>!v) },
        { icon:'#FDE7E4', iconStroke:C.danger, iconPath:'M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z', iconPath2:'', title:'Location Services', isToggle:true, toggleVal:location, onToggle:()=>setLocation(v=>!v) },
        { icon:'#F1F3F7', iconStroke:C.muted, iconPath:'M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z', title:'Language', hasChevron:true, value:lang, onClick:()=>setLangOpen(true) },
        { icon:'#2A3347', iconStroke:'#9AA3B2', iconPath:'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z', title:'Dark Mode', isToggle:true, toggleVal:darkMode, onToggle:()=>setDarkMode(v=>!v) },
      ],
    },
    {
      title:'Privacy & Security',
      rows: [
        { icon:'#F1F3F7', iconStroke:C.muted, iconPath:'M12 1a5 5 0 0 1 5 5v3h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h1V6a5 5 0 0 1 5-5z', title:'Private Profile', isToggle:true, toggleVal:privateProfile, onToggle:()=>setPrivateProfile(v=>!v) },
        { icon:'#FDE7E4', iconStroke:C.danger, iconPath:'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4', title:'Change Password', hasChevron:true, onClick:()=>setPwOpen(true) },
        { icon:'#E9F6FF', iconStroke:C.primary, iconPath:'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z', title:'Data & Permissions', hasChevron:true, onClick:()=>showToast('Data & Permissions coming soon') },
      ],
    },
    {
      title:'Support',
      rows: [
        { icon:'#E9F6FF', iconStroke:C.primary, iconPath:'M12 22C17.523 22 22 17.523 22 12S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z', iconPath2:'M12 8v4m0 4h.01', title:'Help Center', hasChevron:true, onClick:()=>navigate('help-center') },
        { icon:'#E4F7EC', iconStroke:'#15A34A', iconPath:'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', title:'Send Feedback', hasChevron:true, onClick:()=>navigate('feedback') },
        { icon:'#FFF6EC', iconStroke:'#F59E0B', iconPath:'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z', title:'Weekly Digest', hasChevron:true, onClick:()=>navigate('weekly-digest') },
        { icon:'#F1F3F7', iconStroke:C.muted, iconPath:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', iconPath2:'M14 2v6h6', title:'Terms & Privacy', hasChevron:true, onClick:()=>navigate('legal') },
        { icon:'#F1F3F7', iconStroke:C.muted, iconPath:'M12 22C17.523 22 22 17.523 22 12S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z', title:'About Riply', hasChevron:true, onClick:()=>navigate('about') },
      ],
    },
  ];

  const LANGUAGES = ['English','Français','Español','Deutsch','中文','العربية','Português'];

  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative', background:pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif", transition:'background .3s' }}>
      {/* Header */}
      <div style={{ flexShrink:0, background:cardBg, padding:'52px 16px 10px', boxShadow:'0 1px 0 rgba(16,24,40,0.04)', zIndex:4, display:'flex', alignItems:'center', justifyContent:'space-between', transition:'background .3s' }}>
        <span style={{ fontSize:22, fontWeight:800, letterSpacing:-0.6, color:textColor }}>Profile & Settings</span>
        <button onClick={()=>{ setDraftName(currentUser.name); setDraftEmail(currentUser.email); setEditOpen(true); }} style={{ width:40, height:40, border:'none', borderRadius:'50%', background:chipBg, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M5 19h3l9-9-3-3-9 9v3Z" stroke={iconStroke} strokeWidth="1.9" strokeLinejoin="round"/><path d="m14.5 6.5 3 3" stroke={iconStroke} strokeWidth="1.9" strokeLinecap="round"/></svg>
        </button>
      </div>

      {/* Content */}
      <div style={{ flex:1, overflowY:'auto', padding:'22px 16px 104px' }}>
        {/* Identity */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center' }}>
          <button onClick={() => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*';
            input.onchange = async (e) => {
              const file = e.target.files[0]; if (!file) return;
              try {
                const url = await uploadImage(file, 'group avatars', `${currentUser.userId}.jpg`);
                await currentUser.updateProfile({ avatar_url: url });
                showToast('Profile photo updated');
              } catch { showToast('Upload failed. Try again.'); }
            };
            input.click();
          }} style={{ width:96, height:96, borderRadius:'50%', padding:3, background:C.grad, boxShadow:'0 8px 20px rgba(2,162,240,0.35)', position:'relative', border:'none', cursor:'pointer' }}>
            <div style={{ width:'100%', height:'100%', borderRadius:'50%', background:'linear-gradient(135deg,#FF8A3D,#FF5A8A)', display:'flex', alignItems:'center', justifyContent:'center', border:`3px solid ${cardBg}`, position:'relative', overflow:'hidden' }}>
              {currentUser.avatarUrl
                ? <img src={currentUser.avatarUrl} alt="avatar" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                : <><div style={{ position:'absolute', inset:0, background:'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 12px)' }} />
                    <span style={{ fontSize:28, fontWeight:800, color:'#fff', letterSpacing:-1 }}>{initials}</span></>
              }
            </div>
            <div style={{ position:'absolute', bottom:4, right:4, width:26, height:26, borderRadius:'50%', background:C.primary, display:'flex', alignItems:'center', justifyContent:'center', border:`2px solid ${cardBg}` }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 19h3l9-9-3-3-9 9v3Z" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/></svg>
            </div>
          </button>
          <div style={{ fontSize:19, fontWeight:800, letterSpacing:-0.5, color:textColor, marginTop:13 }}>{name}</div>
          <div style={{ display:'flex', alignItems:'center', gap:7, marginTop:7, flexWrap:'wrap', justifyContent:'center' }}>
            <div style={{ display:'inline-flex', alignItems:'center', height:24, padding:'0 11px', borderRadius:999, background:'#E9F6FF', fontSize:9.5, fontWeight:700, color:C.primary }}>{[currentUser.year, currentUser.program].filter(Boolean).join(' · ') || currentUser.university || 'Student'}</div>
            <button onClick={()=>setRoleOpen(r=>!r)} style={{ display:'inline-flex', alignItems:'center', gap:5, height:24, padding:'0 11px', border:'none', borderRadius:999, background:rc.bg, fontSize:9.5, fontWeight:800, color:rc.color, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
              {rc.label}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d={`m6 9 6 6 6-6`} stroke={rc.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
          {roleOpen && (
            <div style={{ background:cardBg, borderRadius:14, boxShadow:'0 8px 24px rgba(16,24,40,0.16)', overflow:'hidden', marginTop:9, width:200 }}>
              {Object.entries(roleConfig).map(([k,v]) => (
                <button key={k} onClick={async ()=>{ setRoleOpen(false); const {error}=await currentUser.updateProfile({role:k}); if(error) showToast('Failed to update role'); else showToast(`Role updated to ${v.label}`); }} style={{ display:'flex', width:'100%', padding:'12px 16px', border:'none', background: profileRole===k?v.bg:'none', cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", fontSize:11.5, fontWeight:800, color: profileRole===k?v.color:textColor, textAlign:'left', alignItems:'center', justifyContent:'space-between' }}>
                  {v.label}
                  {profileRole===k && <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4 4L19 7" stroke={v.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </button>
              ))}
            </div>
          )}
          <div style={{ fontSize:10.5, color:subColor, marginTop:6 }}>{email}</div>
        </div>

        {/* Stats */}
        <div style={{ display:'flex', gap:10, marginTop:20 }}>
          {[{v:stats.events,l:'Events'},{v:stats.groups,l:'Groups'},{v:'–',l:'Friends'}].map(s=>(
            <div key={s.l} style={{ flex:1, background:cardBg, borderRadius:18, padding:'13px 8px', textAlign:'center', boxShadow:'0 4px 14px rgba(16,24,40,0.05)', transition:'background .3s' }}>
              <div style={{ fontSize:17, fontWeight:800, color:textColor }}>{s.v}</div>
              <div style={{ fontSize:9, fontWeight:600, color:subColor, marginTop:2 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Settings groups */}
        {SETTINGS_GROUPS.map(g => (
          <div key={g.title} style={{ marginTop:24 }}>
            <div style={{ fontSize:9, fontWeight:800, letterSpacing:0.6, textTransform:'uppercase', color:subColor, margin:'0 4px 9px' }}>{g.title}</div>
            <div style={{ background:cardBg, borderRadius:18, boxShadow:'0 4px 14px rgba(16,24,40,0.05)', overflow:'hidden', transition:'background .3s' }}>
              {g.rows.map((r, i) => (
                <div key={r.title}>
                  <div
                    onClick={r.hasChevron ? r.onClick : undefined}
                    style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 14px',
                             cursor: r.hasChevron ? 'pointer' : 'default' }}>
                    <div style={{ width:38, height:38, borderRadius:11, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', background:r.icon }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d={r.iconPath} stroke={r.iconStroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>{r.iconPath2&&<path d={r.iconPath2} stroke={r.iconStroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>}</svg>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12.5, fontWeight:700, color:textColor }}>{r.title}</div>
                    </div>
                    {r.isToggle && <Toggle value={r.toggleVal} onChange={e => { e.stopPropagation(); r.onToggle(); }} />}
                    {r.hasChevron && (
                      <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                        {r.value && <span style={{ fontSize:11, fontWeight:700, color:subColor }}>{r.value}</span>}
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
        <button onClick={async ()=>{ if (cu.logout) await cu.logout(); else showToast('Signed out'); }} style={{ width:'100%', height:52, marginTop:24, border:'none', borderRadius:16, background:'linear-gradient(135deg,#FF6B4D,#F4452B)', color:'#fff', fontSize:13.5, fontWeight:800, letterSpacing:0.4, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", display:'flex', alignItems:'center', justifyContent:'center', gap:9, boxShadow:'0 8px 20px rgba(244,69,43,0.32)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 12h10m0 0-3-3m3 3-3 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          LOGOUT
        </button>
        <div style={{ textAlign:'center', fontSize:9, color:subColor, marginTop:16 }}>Riply · v1.0.0</div>
      </div>

      {/* Edit Profile Sheet */}
      {editOpen && (
        <Sheet onClose={()=>setEditOpen(false)} title="Edit Profile">
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:0.4, textTransform:'uppercase', color:subColor, marginBottom:7 }}>Full Name</div>
            <input value={draftName} onChange={e=>setDraftName(e.target.value)} style={{ width:'100%', boxSizing:'border-box', height:48, border:`1.5px solid ${borderColor}`, borderRadius:14, background:chipBg, padding:'0 14px', fontSize:13, fontWeight:700, color:textColor, outline:'none', fontFamily:"'Montserrat',-apple-system,sans-serif" }} />
          </div>
          <div>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:0.4, textTransform:'uppercase', color:subColor, marginBottom:7 }}>Email</div>
            <input value={draftEmail} onChange={e=>setDraftEmail(e.target.value)} inputMode="email" style={{ width:'100%', boxSizing:'border-box', height:48, border:`1.5px solid ${borderColor}`, borderRadius:14, background:chipBg, padding:'0 14px', fontSize:12, fontWeight:600, color:textColor, outline:'none', fontFamily:"'Montserrat',-apple-system,sans-serif" }} />
          </div>
          <button onClick={async ()=>{
            if(draftName.trim().length<2){showToast('Name must be at least 2 characters');return;}
            setSaving(true);
            const { error } = await currentUser.updateProfile({ name: draftName.trim(), email: draftEmail.trim() });
            setSaving(false);
            if(error){ showToast('Failed to save: ' + (error.message || 'Unknown error')); return; }
            setEditOpen(false);
            showToast('Profile updated');
          }} style={{ width:'100%', height:52, marginTop:20, border:'none', borderRadius:15, background:C.grad, color:'#fff', fontSize:14, fontWeight:800, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", boxShadow:'0 8px 20px rgba(2,162,240,0.4)', opacity: saving?0.7:1 }}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </Sheet>
      )}

      {/* Language Sheet */}
      {langOpen && (
        <Sheet onClose={()=>setLangOpen(false)} title="Language">
          {LANGUAGES.map(l => (
            <button key={l} onClick={()=>{setLang(l);setLangOpen(false);showToast(`Language set to ${l}`);}} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', padding:'14px 0', border:'none', background:'none', cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif", borderBottom:`1px solid ${borderColor}` }}>
              <span style={{ fontSize:13, fontWeight: l===lang?800:600, color: l===lang?C.primary:textColor }}>{l}</span>
              {l===lang && <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4 4L19 7" stroke={C.primary} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </button>
          ))}
        </Sheet>
      )}

      {/* Change Password Sheet */}
      {pwOpen && <ChangePasswordSheet onClose={()=>setPwOpen(false)} showToast={showToast} chipBg={chipBg} borderColor={borderColor} textColor={textColor} subColor={subColor} />}
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

  const goRole = (role) => {
    setScreen('auth', { initialStep: 'signup', role });
  };

  return (
    <div style={{ height:'100%', position:'relative', overflow:'hidden',
                  background:'#0a0a0a', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
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
          <RiplyMark size={90} white />
          <div style={{ fontSize:32, fontWeight:900, letterSpacing:6, color:'#19BFFF', marginTop:10 }}>
            RIPLY
          </div>
          <div style={{ fontSize:11, fontWeight:800, letterSpacing:3, color:'rgba(255,255,255,0.85)',
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
            <div style={{ fontSize:22, fontWeight:800, color:'#fff', textAlign:'center',
                          lineHeight:1.45, marginBottom:48 }}>
              Find your space.<br/>
              Explore campus events.<br/>
              Build real lasting connections.
            </div>
            <button onClick={() => setSlide(1)}
              style={{ border:'none', background:'none', cursor:'pointer', padding:0,
                       display:'flex', alignItems:'center', gap:8,
                       fontSize:17, fontWeight:700, color:'#19BFFF' }}>
              Swipe
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M5 12h14M14 6l6 6-6 6" stroke="#19BFFF" strokeWidth="2.4"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}

        {/* Slide 2 content */}
        {onSlide2 && (
          <div style={{ width:'100%', padding:'0 22px 32px' }}>
            <div style={{ fontSize:24, fontWeight:800, color:'#fff', textAlign:'center',
                          marginBottom:10 }}>
              Lets get started !
            </div>
            <div style={{ fontSize:14, color:'rgba(255,255,255,0.78)', textAlign:'center',
                          lineHeight:1.55, marginBottom:28 }}>
              Join thousands of students on campus<br/>and make meaningful connections
            </div>

            {/* Role buttons */}
            {[
              { label:'Group Moderators', icon:(
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L3 7l9 5 9-5-9-5Z" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/>
                  <path d="M3 12l9 5 9-5M3 17l9 5 9-5" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/>
                </svg>
              ), role:'admin' },
              { label:'Event Organizers', icon:(
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="#fff" strokeWidth="2"/>
                  <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              ), role:'organizer' },
              { label:'Student SignUp', icon:(
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3L2 9l10 6 10-6-10-6Z" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/>
                  <path d="M6 12v5c0 2 2.686 3 6 3s6-1 6-3v-5" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              ), role:'student' },
            ].map(({ label, icon, role }) => (
              <button key={role} onClick={() => goRole(role)} style={{
                width:'100%', height:54, border:'none', borderRadius:999, marginBottom:12,
                background:'#19BFFF', cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                fontSize:15, fontWeight:700, color:'#fff',
                fontFamily:"'Montserrat',-apple-system,sans-serif",
                boxShadow:'0 6px 20px rgba(25,191,255,0.35)',
              }}>
                {label}
                {icon}
              </button>
            ))}

            <div style={{ textAlign:'center', marginTop:4, fontSize:11.5,
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

function AuthPillInput({ value, onChange, placeholder, type='text', inputMode, icon, right }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:11, background:'#fff',
                  border:`1.5px solid ${C.border}`, borderRadius:999,
                  padding:'0 20px', height:54,
                  boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
      <input value={value} onChange={onChange} placeholder={placeholder}
        type={type} inputMode={inputMode}
        style={{ flex:1, border:'none', background:'none', fontSize:14, fontWeight:600,
                 color:C.body, outline:'none',
                 fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
      {icon && <div style={{ flexShrink:0, display:'flex', alignItems:'center' }}>{icon}</div>}
      {right}
    </div>
  );
}

function AuthEyeBtn({ show, onToggle }) {
  return (
    <button onClick={onToggle} style={{ border:'none', background:'none', cursor:'pointer',
      padding:0, display:'flex', alignItems:'center', flexShrink:0 }}>
      {show
        ? <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" stroke={C.subtle} strokeWidth="1.9"/><circle cx="12" cy="12" r="3" stroke={C.subtle} strokeWidth="1.9"/></svg>
        : <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M17.9 17.9A10.5 10.5 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.1-6.1M9.9 5.2A9.6 9.6 0 0 1 12 5c7 0 11 7 11 7a18.5 18.5 0 0 1-2.2 3.1M3 3l18 18" stroke={C.subtle} strokeWidth="1.9" strokeLinecap="round"/></svg>
      }
    </button>
  );
}

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
        color:'#fff', fontSize:15, fontWeight:800,
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

function AuthLogo({ size=100 }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
      <div style={{ width:size, height:size, display:'flex', alignItems:'center',
                    justifyContent:'center' }}>
        <RiplyMark size={size} />
      </div>
      <div style={{ fontSize:26, fontWeight:800, letterSpacing:2, color:C.primary }}>RIPLY</div>
      <div style={{ fontSize:10, fontWeight:800, letterSpacing:2.5, color:'#7B8499',
                    textAlign:'center' }}>CAMPUS CONNECTIONS MADE EASY</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREEN: AUTH  (signup → verify → onboard → role → home)
// ─────────────────────────────────────────────────────────────
function AuthScreen({ setScreen, showToast, initialStep, initialRole }) {
  // ── step machine ──────────────────────────────────────────
  const [step,    setStep]    = useState(initialStep || 'login');  // login | signup | verify | onboard | role
  const [animKey, setAnimKey] = useState(0);
  const [code, setCode] = useState(['','','','','','']);
  const codeRef0=useRef(null),codeRef1=useRef(null),codeRef2=useRef(null),codeRef3=useRef(null),codeRef4=useRef(null),codeRef5=useRef(null);
  const codeRefs=[codeRef0,codeRef1,codeRef2,codeRef3,codeRef4,codeRef5];
  const [loading, setLoading] = useState(false);
  const withLoading = (fn) => async (...args) => {
    setLoading(true);
    try { await fn(...args); } finally { setLoading(false); }
  };
  const go = (s) => { setStep(s); setAnimKey(k => k+1); };
  const { login, signup, verify, completeOnboarding } = useClerkAuth(showToast, setScreen, go);

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

  const slideStyle = { animation:`authSlide 0.26s cubic-bezier(.4,0,.2,1)` };

  // Shared hero image header for login & signup
  const AuthHero = ({ onBack }) => (
    <div style={{ position:'relative', height:220, flexShrink:0, overflow:'hidden' }}>
      <img src="https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?w=700&q=80"
        alt="" style={{ width:'100%', height:'100%', objectFit:'cover', objectPosition:'center 30%' }} />
      <div style={{ position:'absolute', inset:0,
        background:'linear-gradient(to bottom,rgba(14,23,38,0.45) 0%,rgba(14,23,38,0.1) 50%,rgba(249,250,252,1) 100%)' }}/>
      {/* back / logo row */}
      <div style={{ position:'absolute', top:0, left:0, right:0, padding:'52px 20px 0',
                    display:'flex', alignItems:'center', gap:12 }}>
        {onBack && (
          <button onClick={onBack} style={{ width:36, height:36, border:'none', borderRadius:999,
            background:'rgba(255,255,255,0.2)', backdropFilter:'blur(8px)',
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <path d="M15 6l-6 6 6 6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
            </svg>
          </button>
        )}
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:30, height:30, borderRadius:10, background:'rgba(255,255,255,0.2)',
            backdropFilter:'blur(8px)', border:'1px solid rgba(255,255,255,0.3)',
            display:'flex', alignItems:'center', justifyContent:'center' }}>
            <RiplyMark size={16} white />
          </div>
          <span style={{ fontSize:16, fontWeight:800, color:'#fff', letterSpacing:-0.3 }}>Riply</span>
        </div>
      </div>
    </div>
  );

  // ── LOGIN ─────────────────────────────────────────────────
  if (step === 'login') return (
    <div key={animKey} style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif",
                  overflow:'hidden', ...slideStyle }}>
      <style>{`@keyframes authSlide{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <AuthHero />
      <div style={{ flex:1, overflowY:'auto', padding:'4px 26px 36px', display:'flex',
                    flexDirection:'column' }}>
        <div style={{ marginBottom:22 }}>
          <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.6, color:C.ink }}>Welcome back</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>Sign in to your campus account</div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:13 }}>
          <AuthPillInput value={email} onChange={e=>setEmail(e.target.value)}
            placeholder="Student email" inputMode="email"
            icon={<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="17" height="13" rx="3" stroke={C.subtle} strokeWidth="1.9"/><path d="m4.5 7 7.5 5.5L19.5 7" stroke={C.subtle} strokeWidth="1.9" strokeLinejoin="round"/></svg>}
          />
          <AuthPillInput value={password} onChange={e=>setPassword(e.target.value)}
            placeholder="Password" type={showPw?'text':'password'}
            right={<AuthEyeBtn show={showPw} onToggle={()=>setShowPw(v=>!v)}/>}
          />
        </div>
        <span onClick={()=>showToast('Password reset coming soon')}
          style={{ fontSize:12.5, fontWeight:700, color:C.primary, marginTop:10,
                   cursor:'pointer', alignSelf:'flex-end' }}>
          Forgot Password?
        </span>
        <div style={{ height:22 }}/>
        <button onClick={withLoading(()=>login(email, password))}
          style={{ width:'100%', height:54, border:'none', borderRadius:16,
            background:'linear-gradient(135deg,#19BFFF,#008FF0)', color:'#fff',
            fontSize:15, fontWeight:800, cursor: loading?'default':'pointer',
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            boxShadow:'0 10px 26px rgba(2,162,240,0.40)', opacity: loading?0.75:1 }}>
          {loading && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ animation:'riplySpin 0.7s linear infinite' }}><circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5"/><path d="M12 3a9 9 0 0 1 9 9" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg>}
          {loading ? 'Signing in…' : 'Log In'}
        </button>
        <div style={{ flex:1 }}/>
        <div style={{ textAlign:'center', fontSize:13, color:C.muted, marginTop:24 }}>
          New to Riply?{' '}
          <span onClick={()=>go('signup')} style={{ color:C.primary, fontWeight:800, cursor:'pointer' }}>
            Create Account
          </span>
        </div>
      </div>
    </div>
  );

  // ── SIGNUP ────────────────────────────────────────────────
  if (step === 'signup') return (
    <div key={animKey} style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif",
                  overflow:'hidden', ...slideStyle }}>
      <AuthHero onBack={()=>go('login')} />
      <div style={{ flex:1, overflowY:'auto', padding:'4px 26px 36px', display:'flex',
                    flexDirection:'column' }}>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.6, color:C.ink }}>Create account</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:4 }}>Join your campus community</div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <AuthPillInput value={name} onChange={e=>setName(e.target.value)}
            placeholder="Username"
            icon={<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke={C.subtle} strokeWidth="1.9"/><path d="M5 20c0-3.6 3-5.6 7-5.6s7 2 7 5.6" stroke={C.subtle} strokeWidth="1.9" strokeLinecap="round"/></svg>}
          />
          <AuthPillInput value={email} onChange={e=>setEmail(e.target.value)}
            placeholder="Student email" inputMode="email"
            icon={<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5.5" width="17" height="13" rx="3" stroke={C.subtle} strokeWidth="1.9"/><path d="m4.5 7 7.5 5.5L19.5 7" stroke={C.subtle} strokeWidth="1.9" strokeLinejoin="round"/></svg>}
          />
          {/* Gender picker */}
          <div>
            <div onClick={()=>setGenderOpen(v=>!v)} style={{ display:'flex', alignItems:'center',
              gap:11, background:'#fff', border:`1.5px solid ${C.border}`, borderRadius:999,
              padding:'0 20px', height:54, cursor:'pointer',
              boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 0v6m-3-3h6" stroke={C.subtle} strokeWidth="1.9" strokeLinecap="round"/></svg>
              <span style={{ flex:1, fontSize:14, fontWeight:600,
                             color: gender ? C.body : C.subtle }}>
                {gender || 'Gender'}
              </span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="m6 9 6 6 6-6" stroke={C.subtle} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            {genderOpen && (
              <div style={{ background:'#fff', border:`1.5px solid ${C.border}`, borderRadius:16,
                            boxShadow:'0 6px 18px rgba(16,24,40,0.10)', overflow:'hidden', marginTop:6 }}>
                {GENDERS.map(g => (
                  <div key={g} onClick={()=>{setGender(g);setGenderOpen(false);}}
                    style={{ padding:'13px 20px', fontSize:14, fontWeight:600,
                             color: gender===g ? C.primary : C.body, cursor:'pointer',
                             background: gender===g ? '#EAF6FF' : 'none',
                             borderBottom:`1px solid ${C.divider}` }}>
                    {g}
                  </div>
                ))}
              </div>
            )}
          </div>
          <AuthPillInput value={password} onChange={e=>setPassword(e.target.value)}
            placeholder="Password" type={showPw?'text':'password'}
            right={<AuthEyeBtn show={showPw} onToggle={()=>setShowPw(v=>!v)}/>}
          />
          <AuthPillInput value={confirm} onChange={e=>setConfirm(e.target.value)}
            placeholder="Confirm password" type={showCf?'text':'password'}
            right={<AuthEyeBtn show={showCf} onToggle={()=>setShowCf(v=>!v)}/>}
          />
        </div>
        <div style={{ height:22 }}/>
        <button onClick={withLoading(()=>signup(name, email, password, confirm))}
          style={{ width:'100%', height:54, border:'none', borderRadius:16,
            background:'linear-gradient(135deg,#19BFFF,#008FF0)', color:'#fff',
            fontSize:15, fontWeight:800, cursor: loading?'default':'pointer',
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            boxShadow:'0 10px 26px rgba(2,162,240,0.40)', opacity: loading?0.75:1 }}>
          {loading && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ animation:'riplySpin 0.7s linear infinite' }}><circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5"/><path d="M12 3a9 9 0 0 1 9 9" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg>}
          {loading ? 'Creating account…' : 'Sign Up'}
        </button>
        <div style={{ textAlign:'center', fontSize:13, color:C.muted, marginTop:18 }}>
          Already have an account?{' '}
          <span onClick={()=>go('login')} style={{ color:C.primary, fontWeight:800, cursor:'pointer' }}>
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
          <span style={{ flex:1, textAlign:'center', fontSize:13, fontWeight:800,
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
          <div style={{ fontSize:22, fontWeight:800, letterSpacing:-0.4, color:C.ink,
                        marginTop:24 }}>Enter Verification Code</div>
          <div style={{ fontSize:13, lineHeight:1.6, color:'#7B8499', textAlign:'center',
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
                           fontSize:20, fontWeight:700, color:C.ink, caretColor:C.primary,
                           transition:'border-color 0.15s' }}/>
              </div>
            ))}
          </div>
          <div style={{ fontSize:13, color:'#7B8499', marginTop:24 }}>
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

  // ── ONBOARD ───────────────────────────────────────────────
  if (step === 'onboard') return (
    <div key={animKey} style={{ height:'100%', display:'flex', flexDirection:'column', position:'relative',
                  background:C.pageBg, fontFamily:"'Montserrat',-apple-system,sans-serif",
                  overflow:'hidden', ...slideStyle }}>
      <div style={bgWash}/>
      <div style={{ position:'relative', flex:1, overflowY:'auto', padding:'60px 26px 24px' }}>
        {/* Progress pip */}
        <div style={{ display:'flex', gap:6, marginBottom:28 }}>
          {['signup','verify','onboard','role'].map((s,i)=>(
            <div key={s} style={{ flex:1, height:4, borderRadius:999,
              background:['signup','verify','onboard'].includes(step)||i<=2 ? C.primary : '#E4E8EF' }}/>
          ))}
        </div>
        <div style={{ fontSize:22, fontWeight:800, letterSpacing:-0.5, color:C.ink, marginBottom:20 }}>
          Tell us about yourself
        </div>

        {/* University */}
        <div style={{ fontSize:13, fontWeight:700, color:C.ink, marginBottom:8 }}>University</div>
        <div style={{ display:'flex', alignItems:'center', gap:11, background:'#fff',
                      border:`1.5px solid ${C.border}`, borderRadius:999,
                      padding:'0 20px', height:54,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
          <input value={university} onChange={e=>setUniversity(e.target.value)}
            placeholder="Search your university"
            style={{ flex:1, border:'none', background:'none', fontSize:14, fontWeight:600,
                     color:C.body, outline:'none',
                     fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
            <path d="M12 3.5 4 7v1.5h16V7l-8-3.5Z" stroke={C.bright} strokeWidth="1.8" strokeLinejoin="round"/>
            <path d="M6 11v6M10 11v6M14 11v6M18 11v6M4 19.5h16" stroke={C.bright} strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </div>

        {/* Campus */}
        <div style={{ fontSize:13, fontWeight:700, color:C.ink, margin:'18px 0 8px' }}>Campus</div>
        <div onClick={()=>setCampusOpen(v=>!v)} style={{ display:'flex', alignItems:'center',
          gap:11, background:'#fff', border:`1.5px solid ${C.border}`, borderRadius:999,
          padding:'0 20px', height:54, cursor:'pointer',
          boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
          <span style={{ flex:1, fontSize:14, fontWeight:600,
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
                style={{ padding:'13px 20px', fontSize:14, fontWeight:600,
                         color: campus===c ? C.primary : C.body, cursor:'pointer',
                         background: campus===c ? '#EAF6FF' : 'none',
                         borderBottom:`1px solid ${C.divider}` }}>
                {c}
              </div>
            ))}
          </div>
        )}

        {/* Program */}
        <div style={{ fontSize:13, fontWeight:700, color:C.ink, margin:'18px 0 8px' }}>Program</div>
        <div style={{ display:'flex', alignItems:'center', gap:11, background:'#fff',
                      border:`1.5px solid ${C.border}`, borderRadius:999,
                      padding:'0 20px', height:54,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
          <input value={program} onChange={e=>setProgram(e.target.value)}
            placeholder="e.g. Computer Science"
            style={{ flex:1, border:'none', background:'none', fontSize:14, fontWeight:600,
                     color:C.body, outline:'none',
                     fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
            <path d="M12 4 3 8l9 4 9-4-9-4Z" stroke={C.bright} strokeWidth="1.9" strokeLinejoin="round"/>
            <path d="M7 10.5V15c0 1.2 2.2 2.5 5 2.5s5-1.3 5-2.5v-4.5" stroke={C.bright} strokeWidth="1.9" strokeLinecap="round"/>
          </svg>
        </div>

        {/* Year */}
        <div style={{ fontSize:13, fontWeight:700, color:C.ink, margin:'20px 0 11px' }}>
          What year are you in?
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
          {YEARS.map(y=>(
            <button key={y} onClick={()=>setYear(y)} style={{
              height:38, padding:'0 16px', border:'none', borderRadius:999, cursor:'pointer',
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              fontSize:12, fontWeight:700,
              background: year===y ? C.primary : C.card,
              color: year===y ? '#fff' : C.muted,
              boxShadow: year===y ? '0 4px 12px rgba(2,162,240,0.3)' : `0 0 0 1.5px ${C.border}`,
            }}>{y}</button>
          ))}
        </div>
      </div>
      <div style={{ position:'relative', flexShrink:0, padding:'12px 26px 32px' }}>
       <AuthBigBtn fullWidth onClick={()=>{
          if(!university.trim()){showToast('Enter your university');return;}
          if(!campus){showToast('Select your campus');return;}
          go('role');
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
          {[0,1,2,3].map(i=>(
            <div key={i} style={{ flex:1, height:4, borderRadius:999,
              background: i<=3 ? C.primary : '#E4E8EF' }}/>
          ))}
        </div>
        <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.6, color:C.ink,
                      lineHeight:1.18 }}>
          How will you use Riply?
        </div>
        <div style={{ fontSize:13, lineHeight:1.6, color:'#7B8499', marginTop:9 }}>
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
                  <div style={{ fontSize:15, fontWeight:800, color:C.ink }}>{r.title}</div>
                  <div style={{ fontSize:12, color:'#7B8499', marginTop:3, lineHeight:1.45 }}>{r.sub}</div>
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
          onClick={withLoading(()=>completeOnboarding(role, university, campus, program, year))}
        >{role ? 'Enter Riply' : 'Select an account type'}</AuthBigBtn>
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

// Deterministic pseudo-QR matrix (17×17 cells)
function makeQR(seed) {
  const N = 17;
  let x = (seed * 2654435761) >>> 0;
  const rnd = () => { x = ((x * 1103515245) + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  const cells = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      // Simple finder-pattern corners
      const inCorner = (br, bc) => r>=br && r<br+5 && c>=bc && c<bc+5;
      let val;
      if (inCorner(0,0) || inCorner(0,N-5) || inCorner(N-5,0)) {
        const lr = r % 5 === 0 || r % 5 === 4 || c % 5 === 0 || c % 5 === 4;
        const mid = r % 5 >= 1 && r % 5 <= 3 && c % 5 >= 1 && c % 5 <= 3;
        val = lr || mid;
      } else {
        val = rnd() > 0.48;
      }
      cells.push(val);
    }
  }
  return cells;
}

// ─────────────────────────────────────────────────────────────
// SCREEN: MY TICKETS
// ─────────────────────────────────────────────────────────────
function MyTicketsScreen({ goBack, navigate, showToast }) {
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
    supabase
      .from('tickets')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setTickets(data || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [user?.id]);

  const allTickets = tickets.length > 0 ? tickets : TICKETS_DATA;
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
          <div style={{ flex:1, textAlign:'center', fontSize:16, fontWeight:800,
                        letterSpacing:-0.4, color:C.ink }}>My Tickets</div>
          <div style={{ width:40, flexShrink:0 }}/>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:0, borderBottom:`1px solid ${C.divider}` }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex:1, height:40, border:'none', background:'none', cursor:'pointer',
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              fontSize:13, fontWeight: t.id===tab ? 800 : 600,
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
          <div style={{ textAlign:'center', padding:'60px 24px', color:C.subtle, fontSize:14, fontWeight:700 }}>
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
            <div style={{ fontSize:14, fontWeight:700, color:C.muted }}>No tickets here yet</div>
            <div style={{ fontSize:12, color:C.subtle, marginTop:6, lineHeight:1.5 }}>
              Reserve a spot at an event and your<br/>ticket will appear here.
            </div>
            <button onClick={goBack} style={{ marginTop:18, height:44, padding:'0 28px',
              border:'none', borderRadius:14, background:C.grad, color:'#fff',
              fontSize:13, fontWeight:800, cursor:'pointer',
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              boxShadow:'0 8px 20px rgba(2,162,240,0.32)' }}>
              Browse Events
            </button>
          </div>
        )}

        {list.map((tk, idx) => {
          const isActive = tk.status === 'ACTIVE';
          const cells = makeQR(idx * 17 + 3);

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
                  <div style={{ fontSize:17, fontWeight:800, letterSpacing:-0.4,
                                color:C.ink, lineHeight:1.2 }}>{tk.title}</div>
                  <div style={{ fontSize:12, fontWeight:700, color:C.primary, marginTop:5 }}>
                    {tk.access}
                  </div>
                </div>
                <span style={{ flexShrink:0, display:'inline-flex', alignItems:'center',
                               height:26, padding:'0 12px', borderRadius:999, fontSize:10,
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
                  { label:'Location', value:tk.location, full:true },
                ].map(row => (
                  <div key={row.label}
                    style={{ gridColumn: row.full ? '1 / -1' : 'auto' }}>
                    <div style={{ fontSize:10, fontWeight:600, color:C.subtle,
                                  textTransform:'uppercase', letterSpacing:0.3 }}>
                      {row.label}
                    </div>
                    <div style={{ fontSize:12.5, fontWeight:700, color:C.body, marginTop:3 }}>
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
                  {/* QR grid */}
                  <div style={{ display:'grid', gridTemplateColumns:`repeat(17,1fr)`,
                                width:136, height:136, gap:0 }}>
                    {cells.map((on, i) => (
                      <div key={i} style={{
                        width:'100%', height:'100%',
                        background: on
                          ? (isActive ? C.ink : '#9AA3B2')
                          : 'transparent',
                        borderRadius:1,
                      }}/>
                    ))}
                  </div>
                </div>

                {/* Ticket ID */}
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11,
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
                    <span style={{ fontSize:11, fontWeight:700, color:'#0E9F6E' }}>
                      Valid · Show QR at the door
                    </span>
                  </div>
                )}
              </div>

              {/* ── Action buttons ────────────────────────── */}
              <div style={{ padding:'10px 14px 16px', display:'flex', gap:9 }}>
                <button onClick={() => showToast('Added to calendar')}
                  style={{ flex:1, height:44, border:`1.5px solid ${C.border}`,
                           borderRadius:13, background:C.card, fontSize:12,
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
                           borderRadius:13, background:C.card, fontSize:12,
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
                             background:C.grad, fontSize:12, fontWeight:800,
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
  const [uploading, setUploading] = useState(false);
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
        <div style={{ flex:1, textAlign:'center', fontSize:15, fontWeight:800,
                      letterSpacing:-0.4, color:C.ink }}>Create Campus Group</div>
        <button onClick={() => showToast('Draft saved')} style={{
          height:40, padding:'0 15px', border:'none', borderRadius:13, background:C.chip,
          fontSize:12, fontWeight:700, color:C.muted, cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif", flexShrink:0,
        }}>Draft</button>
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
            try {
              const url = await uploadImage(file, 'event-covers', Date.now() + '.jpg');
              setCoverUrl(url);
              showToast('Cover photo uploaded ✓');
            } catch(err) {
              showToast('Upload failed. Try again.');
            }
            input.value = '';
          };
          input.click();
        }} style={{
          width:'100%', height:140, borderRadius:20, border:'2px dashed #C7D2E0',
          background:coverGrad, position:'relative', overflow:'hidden', cursor:'pointer',
          display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          gap:7, fontFamily:"'Montserrat',-apple-system,sans-serif",
        }}>
          <div style={{ position:'absolute', inset:0, background:
            'repeating-linear-gradient(135deg,rgba(255,255,255,0.10) 0,rgba(255,255,255,0.10) 2px,transparent 2px,transparent 16px)' }}/>
          <div style={{ width:42, height:42, borderRadius:13, background:'rgba(255,255,255,0.92)',
                        display:'flex', alignItems:'center', justifyContent:'center', position:'relative' }}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none">
              <rect x="3.5" y="6" width="17" height="13" rx="3" stroke={C.primary} strokeWidth="1.9"/>
              <circle cx="12" cy="12.5" r="3" stroke={C.primary} strokeWidth="1.9"/>
              <path d="M8.5 6l1-2h5l1 2" stroke={C.primary} strokeWidth="1.9" strokeLinejoin="round"/>
            </svg>
          </div>
          <span style={{ fontSize:12, fontWeight:800, color:'#fff', position:'relative' }}>
            Add cover photo
          </span>
          <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
                         color:'rgba(255,255,255,0.82)', position:'relative' }}>
            Recommended 1200×400
          </span>
        </button>

        {/* Group avatar preview */}
        <button onClick={() => showToast('Tap to upload a group logo')} style={{
          display:'flex', alignItems:'center', gap:13, width:'100%', background:C.card,
          border:`1.5px solid ${C.border}`, borderRadius:16, padding:12, cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif", marginTop:12, textAlign:'left',
        }}>
          <div style={{ width:54, height:54, borderRadius:16, flexShrink:0,
                        background:coverGrad, position:'relative', overflow:'hidden',
                        display:'flex', alignItems:'center', justifyContent:'center' }}>
            <div style={{ position:'absolute', inset:0, background:
              'repeating-linear-gradient(135deg,rgba(255,255,255,0.14) 0,rgba(255,255,255,0.14) 2px,transparent 2px,transparent 9px)' }}/>
            <span style={{ position:'relative', fontSize:22, fontWeight:800, color:'#fff' }}>
              {initial}
            </span>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:800, color:C.ink }}>Group icon</div>
            <div style={{ fontSize:11, color:C.subtle, marginTop:2 }}>Tap to upload a logo</div>
          </div>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <path d="M5 19h3l9-9-3-3-9 9v3Z" stroke={C.subtle} strokeWidth="1.8" strokeLinejoin="round"/>
            <path d="m14.5 6.5 3 3" stroke={C.subtle} strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Group Name */}
        <div style={{ marginTop:22 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
            Group Name
          </div>
          <div style={{ display:'flex', alignItems:'center', background:C.card,
                        border:`1.5px solid ${C.border}`, borderRadius:13,
                        padding:'0 15px', height:48 }}>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Photography Club"
              style={{ flex:1, border:'none', background:'none', outline:'none',
                       fontSize:13, fontWeight:700, color:C.body,
                       fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
            {name.trim().length > 0 && (
              <span style={{ fontSize:11, fontWeight:700, color:C.subtle, flexShrink:0 }}>
                {name.trim().length}/60
              </span>
            )}
          </div>
        </div>

        {/* Category */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:9 }}>
            Category
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {CATS.map(c => (
              <button key={c.id} onClick={() => setCat(c.id)} style={{
                flexShrink:0, height:34, padding:'0 14px', borderRadius:999, cursor:'pointer',
                border: c.id===cat ? 'none' : `1.5px solid ${C.border}`,
                fontSize:12, fontWeight:700,
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
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
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
                  <div style={{ fontSize:13, fontWeight:800 }}>{p.label}</div>
                  <div style={{ fontSize:10, opacity:0.75, fontWeight:600, marginTop:2 }}>
                    {p.sub}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Description */}
        <div style={{ marginTop:22 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
            Description
          </div>
          <textarea value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="What is your group about? Who should join and what will you do together…"
            style={{ width:'100%', boxSizing:'border-box', minHeight:90,
                     border:`1.5px solid ${C.border}`, borderRadius:14, background:C.card,
                     padding:13, fontSize:12.5, fontWeight:500, lineHeight:1.6,
                     color:C.body, outline:'none', resize:'none',
                     fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
        </div>

        {/* Where you meet */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
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
                       fontSize:12, fontWeight:600, color:C.body,
                       fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
          </div>
        </div>

        {/* Group Rules */}
        <div style={{ marginTop:22 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                        marginBottom:10 }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                          textTransform:'uppercase', color:C.subtle }}>
              Group Rules
            </div>
            <span style={{ fontSize:10, fontWeight:700, color:C.subtle }}>
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
                              background:'#E9F6FF', fontSize:11, fontWeight:800, color:C.primary }}>
                  {i + 1}
                </div>
                <span style={{ flex:1, fontSize:12, fontWeight:600, color:C.body,
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
                       background:C.card, padding:'0 13px', fontSize:12, fontWeight:600,
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
            <span style={{ fontSize:11, fontWeight:600, color:'#92400E' }}>
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
          }).select().single();
          if (error) { setSubmitting(false); showToast('Failed to create group: ' + error.message); return; }
          // Add creator as first member with admin role
          await supabase.from('group_members').insert({
            group_id: group.id,
            user_id: currentUser.userId,
            role: 'admin',
          });
          setSubmitting(false);
          showToast('Group created! 🎉');
          navigate('group-profile', { groupId: group.id });
        }} style={{
          width:'100%', height:50, border:'none', borderRadius:15,
          cursor: canCreate && !submitting ? 'pointer' : 'not-allowed',
          background: canCreate ? 'linear-gradient(135deg,#19BFFF,#008FF0)' : '#C5CBD6',
          color:'#fff', fontSize:14, fontWeight:800,
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
      borderRadius:12, fontSize:12, fontWeight:700,
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
        <div style={{ flex:1, textAlign:'center', fontSize:15, fontWeight:800,
                      letterSpacing:-0.4, color:C.ink }}>Create Student Space</div>
        <button onClick={() => showToast('Draft saved')}
          style={{ height:40, padding:'0 15px', border:'none', borderRadius:13,
                   background:C.chip, fontSize:12, fontWeight:700, color:C.muted,
                   cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
                   flexShrink:0 }}>
          Draft
        </button>
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
              const url = await uploadImage(file, 'event-covers', Date.now() + '.jpg');
              setCoverUrl(url);
              showToast('Cover photo uploaded ✓');
            } catch(err) {
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
          <div style={{ fontSize:12, fontWeight:800, color:'#fff', position:'relative', zIndex:2 }}>
            {uploading ? 'Uploading…' : coverUrl ? 'Cover uploaded ✓' : 'Add space cover'}
          </div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9,
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
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:9 }}>
            Category
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {CATS.map(c => (
              <button key={c.id} onClick={() => setCat(c.id)} style={{
                flexShrink:0, height:34, padding:'0 15px', borderRadius:999,
                cursor:'pointer', border: c.id===cat ? 'none' : `1.5px solid ${C.border}`,
                fontSize:12, fontWeight:700,
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
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
            Space Name
          </div>
          <div style={{ display:'flex', alignItems:'center', background:C.card,
                        border:`1.5px solid ${C.border}`, borderRadius:13,
                        padding:'0 14px', height:46 }}>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Seasonal Basketball 5v5"
              style={{ flex:1, border:'none', background:'none', outline:'none',
                       fontSize:13, fontWeight:600, color:C.body,
                       fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
          </div>
        </div>

        {/* Schedule */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
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
              <span style={{ flex:1, fontSize:12, fontWeight:600, color:C.muted }}>First date</span>
              <input type="date" value={firstDate} onChange={e => setFirstDate(e.target.value)}
                style={{ border:'none', background:'none', fontSize:13, fontWeight:700,
                         color: firstDate ? C.body : C.muted, outline:'none', textAlign:'right',
                         fontFamily:"'Montserrat',-apple-system,sans-serif", colorScheme:'light' }}/>
            </div>
            {/* Start time */}
            <div style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 0', borderBottom:`1px solid ${C.divider}` }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
                <circle cx="12" cy="12" r="8.5" stroke={C.primary} strokeWidth="1.9"/>
                <path d="M12 8v4.5l3 2" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span style={{ flex:1, fontSize:12, fontWeight:600, color:C.muted }}>Start time</span>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                style={{ border:'none', background:'none', fontSize:13, fontWeight:700,
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
              <span style={{ flex:1, fontSize:12, fontWeight:600, color:C.muted }}>Duration</span>
              <select value={duration} onChange={e => setDuration(e.target.value)}
                style={{ border:'none', background:'none', fontSize:13, fontWeight:700,
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
            <span style={{ flex:1, fontSize:12, fontWeight:600, color:C.muted }}>Repeats weekly</span>
            {repeat && (
              <div style={{ display:'flex', alignItems:'center', gap:6, marginRight:8 }}>
                <input
                  value={repeatWeeks} onChange={e => setRepeatWeeks(e.target.value.replace(/\D/g,''))}
                  placeholder="?"
                  inputMode="numeric"
                  style={{ width:36, height:26, border:`1.5px solid ${C.border}`, borderRadius:8,
                           background:C.card, textAlign:'center', fontSize:12, fontWeight:700,
                           color:C.body, outline:'none',
                           fontFamily:"'Montserrat',-apple-system,sans-serif" }}
                />
                <span style={{ fontSize:11, fontWeight:600, color:C.muted }}>wks</span>
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
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
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
                       fontSize:12, fontWeight:600, color:C.body,
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
                       fontSize:12, fontWeight:600, color:C.body,
                       fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
          </div>
        </div>

        {/* Spots */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
            Spots
          </div>
          <div style={{ background:C.card, border:`1.5px solid ${C.border}`,
                        borderRadius:16, padding:'14px 16px' }}>
            {/* Stepper */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:13, fontWeight:700, color:C.body }}>
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
                <span style={{ fontSize:16, fontWeight:800, color:C.ink,
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
                <div style={{ fontSize:13, fontWeight:700, color:C.body }}>
                  Notify when a spot opens
                </div>
                <div style={{ fontSize:11, color:C.subtle, marginTop:2 }}>
                  Alert waiting participants automatically
                </div>
              </div>
              <InlineToggle value={notifySpot} onChange={() => setNotifySpot(v => !v)}/>
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
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
              <span style={{ fontSize:16, fontWeight:800, color:C.muted }}>$</span>
              <input value={price} onChange={e => setPrice(e.target.value)}
                placeholder="Price per spot (e.g. 5.00)"
                inputMode="decimal"
                style={{ flex:1, border:'none', background:'none', outline:'none',
                         fontSize:13, fontWeight:700, color:C.body,
                         fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
            </div>
          )}
        </div>

        {/* About */}
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4,
                        textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
            About
          </div>
          <textarea value={about} onChange={e => setAbout(e.target.value)}
            placeholder="What is this space about? Who should join and what will you do…"
            style={{ width:'100%', boxSizing:'border-box', minHeight:88,
                     border:`1.5px solid ${C.border}`, borderRadius:14,
                     background:C.card, padding:14, fontSize:12.5, fontWeight:500,
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
            <span style={{ fontSize:11, fontWeight:600, color:'#92400E' }}>
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
          }).select().single();
          setSubmitting(false);
          if (error) { showToast('Failed to create space: ' + error.message); return; }
          showToast('Space created! 🎉');
          navigate('space-details', { spaceId: space.id });
        }} style={{
          width:'100%', height:50, border:'none', borderRadius:15,
          cursor: canCreate && !submitting ? 'pointer' : 'not-allowed',
          background: canCreate ? 'linear-gradient(135deg,#19BFFF,#008FF0)' : '#C5CBD6',
          color:'#fff', fontSize:14, fontWeight:800,
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
    <div style={{ fontSize:10, fontWeight:700, letterSpacing:0.4, textTransform:'uppercase',
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
        style={{ flex:1, border:'none', background:'none', outline:'none', fontSize:13,
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
      borderRadius:12, fontSize:12, fontWeight:700, cursor:'pointer',
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
function CreateEventScreen({ goBack, navigate, showToast, currentUser }) {
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

  const [submitting, setSubmitting] = useState(false);
  const activeCat = CATS.find(c => c.id === cat) || CATS[0];
  const isPaid = pricing === 'paid';
  const canPublish = title.trim().length > 0;

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
        <div style={{ flex:1, textAlign:'center', fontSize:15, fontWeight:800,
                      letterSpacing:-0.4, color:C.ink }}>Create Event</div>
        <button onClick={() => showToast('Draft saved')}
          style={{ height:40, padding:'0 15px', border:'none', borderRadius:13,
                   background:C.chip, fontSize:12, fontWeight:700, color:C.muted,
                   cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
                   flexShrink:0 }}>
          Draft
        </button>
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
              const url = await uploadImage(file, 'event-covers', `${Date.now()}.jpg`);
              setCoverUrl(url);
              showToast('Cover photo uploaded ✓');
            } catch(err) {
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
          <div style={{ fontSize:12.5, fontWeight:800, color:'#fff', position:'relative' }}>
            {uploading ? 'Uploading…' : coverUrl ? 'Cover uploaded ✓' : 'Add cover photo'}
          </div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:9.5,
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
                fontSize:12, fontWeight:700,
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
              style={{ flex:1, border:'none', background:'none', outline:'none', fontSize:13,
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
                <span style={{ flex:1, fontSize:12, fontWeight:600, color:C.muted }}>{r.label}</span>
                <input
                  type={r.type} value={r.val} onChange={e => r.set(e.target.value)}
                  style={{ border:'none', background:'none', fontSize:13, fontWeight:700,
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
            <span style={{ flex:1, fontSize:12, fontWeight:600, color:C.muted }}>Repeats weekly</span>
            {repeat && (
              <div style={{ display:'flex', alignItems:'center', gap:6, marginRight:8 }}>
                <input value={repeatWeeks} onChange={e => setRepeatWeeks(e.target.value.replace(/\D/g,''))}
                  placeholder="?" inputMode="numeric"
                  style={{ width:36, height:26, border:`1.5px solid ${C.border}`, borderRadius:8,
                           background:C.card, textAlign:'center', fontSize:12, fontWeight:700,
                           color:C.body, outline:'none', fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
                <span style={{ fontSize:11, fontWeight:600, color:C.muted }}>wks</span>
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
              style={{ flex:1, border:'none', background:'none', outline:'none', fontSize:12,
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
              style={{ flex:1, border:'none', background:'none', outline:'none', fontSize:12,
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
              <span style={{ fontSize:16, fontWeight:800, color:C.muted }}>$</span>
              <input value={price} onChange={e => setPrice(e.target.value)}
                placeholder="Price per ticket (e.g. 15.00)"
                inputMode="decimal" type="text"
                style={{ flex:1, border:'none', background:'none', outline:'none', fontSize:13,
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
              <span style={{ fontSize:13, fontWeight:700, color:C.body }}>Max attendees</span>
              <div style={{ display:'flex', alignItems:'center', gap:13 }}>
                <EventCounterBtn minus onClick={() => !unlimited && setCapacity(v => Math.max(10, v - 10))}/>
                <span style={{ fontSize:16, fontWeight:800, color:C.ink, minWidth:34, textAlign:'center' }}>
                  {unlimited ? '∞' : capacity}
                </span>
                <EventCounterBtn onClick={() => !unlimited && setCapacity(v => v + 10)}/>
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:9, marginTop:13,
                          paddingTop:13, borderTop:`1px solid ${C.divider}` }}>
              <span style={{ flex:1, fontSize:12, fontWeight:600, color:C.muted }}>Unlimited capacity</span>
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
                     padding:14, fontSize:12.5, fontWeight:500, lineHeight:1.6,
                     color:C.body, outline:'none', resize:'none',
                     fontFamily:"'Montserrat',-apple-system,sans-serif" }}
          />
        </div>

        {/* Guest List */}
        <div style={{ marginTop:20 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <EventLabel>Guest List</EventLabel>
            <span style={{ fontSize:10, fontWeight:700, color:C.subtle }}>{guests.length} added</span>
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
                                color:'#fff', fontSize:13, fontWeight:800 }}>
                    {g.name[0].toUpperCase()}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12.5, fontWeight:700, color:C.body,
                                  whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{g.name}</div>
                    {g.role && <div style={{ fontSize:10.5, color:C.subtle, marginTop:1 }}>{g.role}</div>}
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
                style={{ flex:1, border:'none', background:'none', outline:'none', fontSize:12.5,
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
                style={{ flex:1, border:'none', background:'none', outline:'none', fontSize:12.5,
                         fontWeight:600, color:C.body, fontFamily:"'Montserrat',-apple-system,sans-serif" }}
              />
            </div>
          </div>
          <button onClick={addGuest} style={{
            marginTop:9, width:'100%', height:40, border:`1.5px solid ${C.border}`,
            borderRadius:12, background:C.card, fontSize:12, fontWeight:700,
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
            <span style={{ fontSize:10, fontWeight:700, color:C.subtle }}>
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
                  <span style={{ fontSize:12, fontWeight:600, color: on ? C.body : '#7B8499' }}>{r}</span>
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
        {!canPublish && (
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10,
                        background:'#FFF6EC', borderRadius:10, padding:'9px 12px' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="#F59E0B" strokeWidth="2"/>
              <path d="M12 8v5M12 16h.01" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize:11, fontWeight:600, color:'#92400E' }}>
              Add an event title to publish
            </span>
          </div>
        )}
        <button
          onClick={async () => {
            if (!canPublish) { showToast('Add an event title first'); return; }
            if (!currentUser.userId) { showToast('You must be logged in to publish an event'); return; }
            setSubmitting(true);
            const location = [venue, room].filter(Boolean).join(' · ');
            const timeRange = [startTime, endTime].filter(Boolean).join(' – ');
            const selectedRules = Object.entries(rules).filter(([,v])=>v).map(([k])=>k);
            const { data: event, error } = await supabase.from('events').insert({
              title: title.trim(),
              org: currentUser.name || 'Organizer',
              org_initial: (currentUser.name || 'O')[0].toUpperCase(),
              description: about.trim(),
              full_desc: about.trim(),
              category: cat,
              tags: [cat],
              location: location || null,
              venue: venue.trim() || null,
              room: room.trim() || null,
              date: date || null,
              full_date: date || null,
              start_time: startTime || null,
              time_range: timeRange || null,
              repeat_weeks: repeat && repeatWeeks ? parseInt(repeatWeeks, 10) : null,
              image_url: coverUrl || null,
              price: isPaid ? `$${price}` : 'Free',
              capacity: unlimited ? null : capacity,
              attendee_count: 0,
              likes: 0,
              saves: 0,
              shares: 0,
              trending: false,
              badge: repeat ? (() => { try { const d = new Date(date); return isNaN(d) ? 'Every Week' : 'Every ' + d.toLocaleDateString('en-US',{weekday:'long'}); } catch { return 'Every Week'; } })() : null,
              rules: selectedRules.length ? selectedRules : null,
              guests: guests.length ? guests : null,
            }).select().single();
            setSubmitting(false);
            if (error) { showToast('Failed to publish: ' + error.message); return; }
            showToast('Event published! 🎉');
            navigate('event-details', { eventId: event.id });
          }}
          style={{
            width:'100%', height:50, border:'none', borderRadius:15,
            cursor: canPublish && !submitting ? 'pointer' : 'not-allowed',
            background: canPublish ? 'linear-gradient(135deg,#19BFFF,#008FF0)' : '#C5CBD6',
            color:'#fff', fontSize:14, fontWeight:800,
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:9,
            boxShadow: canPublish ? '0 8px 20px rgba(2,162,240,0.4)' : 'none',
            opacity: submitting ? 0.7 : 1,
          }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"
                  stroke="#fff" strokeWidth="1.9" strokeLinejoin="round"/>
          </svg>
          {submitting ? 'Publishing…' : 'Publish Event'}
          {canPublish && !submitting && (
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
// SCREEN: GROUP MANAGE
// ─────────────────────────────────────────────────────────────
function GroupManageScreen({ groupId, goBack, navigate, showToast }) {
  const g = GROUPS.find(gr => gr.id === groupId) || GROUPS[0];

  const SETTINGS = [
    { key:'info',    label:'Edit Group Info',    iconBg:'#E9F6FF', iconColor:C.primary,
      icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M5 19h3l9-9-3-3-9 9v3Z" stroke={C.primary} strokeWidth="1.9" strokeLinejoin="round"/><path d="m14.5 6.5 3 3" stroke={C.primary} strokeWidth="1.9" strokeLinecap="round"/></svg>,
      onPress:()=>navigate('group-edit',{groupId:g.id, editTab:'info'}) },
    { key:'social',  label:'Social Media Links',  iconBg:'#F1ECFF', iconColor:'#7C5CFF',
      icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M9 15l6-6M8 12l-2 2a3 3 0 1 0 4 4l2-2M16 12l2-2a3 3 0 1 0-4-4l-2 2" stroke="#7C5CFF" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      onPress:()=>navigate('group-edit',{groupId:g.id, editTab:'social'}) },
    { key:'rules',   label:'Group Rules',          iconBg:'#FFF6EC', iconColor:'#F59E0B',
      icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M4 6h10M4 12h10M4 18h6" stroke="#F59E0B" strokeWidth="1.9" strokeLinecap="round"/><path d="m16 6 2 2 3-3M16 16l2 2 3-3" stroke="#F59E0B" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      onPress:()=>navigate('group-edit',{groupId:g.id, editTab:'rules'}) },
    { key:'privacy', label:'Privacy Settings',     iconBg:'#E4F7EC', iconColor:'#15A34A',
      icon:<svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M12 3.5 5 6v5.5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-2.5Z" stroke="#15A34A" strokeWidth="1.9" strokeLinejoin="round"/></svg>,
      onPress:()=>navigate('group-edit',{groupId:g.id, editTab:'privacy'}) },
  ];

  const ACTIVITY = [
    { title:'15 new members joined today',    time:'2 hours ago', iconBg:'#E9F6FF',
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="8" cy="9" r="2.6" stroke={C.primary} strokeWidth="1.8"/><circle cx="16" cy="9" r="2.6" stroke={C.primary} strokeWidth="1.8"/><path d="M3.5 18c0-2.4 2-3.8 4.5-3.8M20.5 18c0-2.4-2-3.8-4.5-3.8M9 18c0-2 1.4-3.2 3-3.2s3 1.2 3 3.2" stroke={C.primary} strokeWidth="1.8" strokeLinecap="round"/></svg> },
    { title:'42 new comments this week',       time:'1 day ago',   iconBg:'#E4F7EC',
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3.5V16.5H6a2 2 0 0 1-2-2Z" stroke="#15A34A" strokeWidth="1.8" strokeLinejoin="round"/></svg> },
    { title:'3 posts reported for review',      time:'3 days ago',  iconBg:'#FFF1ED',
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 3v18M6 4h11l-2 4 2 4H6" stroke="#F4452B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  ];

  const MODERATION = [
    { label:'Review Reports',    iconBg:'#FFF1ED', iconColor:'#F4452B', badge:'3',
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#F4452B" strokeWidth="1.8"/><path d="M12 7.5v5M12 16h.01" stroke="#F4452B" strokeWidth="2" strokeLinecap="round"/></svg>,
      onPress:()=>showToast('Reports coming soon') },
    { label:'Pending Requests',  iconBg:'#FFF6EC', iconColor:'#F59E0B', badge:'8',
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="#F59E0B" strokeWidth="1.8"/><path d="M12 8v4.5l3 2" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      onPress:()=>navigate('pending-requests',{groupId:g.id}) },
    { label:'Banned Members',    iconBg:'#F1F3F7', iconColor:'#5B6473', badge:null,
      icon:<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="#5B6473" strokeWidth="1.8"/><path d="m6 6 12 12" stroke="#5B6473" strokeWidth="1.8" strokeLinecap="round"/></svg>,
      onPress:()=>navigate('banned-members',{groupId:g.id}) },
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
      <span style={{ flex:1, textAlign:'left', fontSize:14.5, fontWeight:700,
                     color:C.ink }}>{label}</span>
      {badge && (
        <span style={{ minWidth:22, height:22, padding:'0 6px', borderRadius:999,
                       background:'#F4452B', color:'#fff', fontSize:11,
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
        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Group Settings</div>
        <div style={{ width:40 }}/>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'16px 16px 30px' }}>

        {/* Group header card */}
        <div style={{ background:'#fff', borderRadius:20,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)',
                      padding:16, display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ width:62, height:62, borderRadius:'50%', flexShrink:0,
                        background:g.logoColor || g.logo_color || "linear-gradient(135deg,#19BFFF,#0098F0)", display:'flex', alignItems:'center',
                        justifyContent:'center', color:'#fff', fontSize:20,
                        fontWeight:800, position:'relative', overflow:'hidden',
                        boxShadow:`0 0 0 2.5px #fff, 0 0 0 4px ${C.primary}` }}>
            <span>{g.initial || (g.name || "G")[0].toUpperCase()}</span>
            <div style={{ position:'absolute', inset:0, background:
              'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 9px)'}}/>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:17, fontWeight:800, letterSpacing:-0.3,
                          color:C.ink }}>{g.name}</div>
            <div style={{ fontSize:12.5, color:C.subtle, marginTop:2 }}>
              {g.count || g.member_count || 0} members · 156 active today
            </div>
            <div style={{ display:'flex', gap:7, marginTop:8 }}>
              <span style={{ display:'inline-flex', alignItems:'center', height:22,
                             padding:'0 10px', borderRadius:999, background:'#EDE7FF',
                             fontSize:11, fontWeight:700, color:'#7C5CFF' }}>Public</span>
              <span style={{ display:'inline-flex', alignItems:'center', gap:4,
                             height:22, padding:'0 10px', borderRadius:999,
                             background:'#E4F7EC', fontSize:11, fontWeight:700,
                             color:'#15A34A' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2.5l2.2 1.6 2.7-.2 1 2.5 2.3 1.4-.6 2.6.6 2.6-2.3 1.4-1 2.5-2.7-.2L12 21.5 9.8 19.9l-2.7.2-1-2.5-2.3-1.4.6-2.6L3.8 11l2.3-1.4 1-2.5 2.7.2L12 2.5Z"
                        fill="#15A34A"/>
                  <path d="m9 12 2 2 4-4.5" stroke="#fff" strokeWidth="1.8"
                        strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Verified
              </span>
            </div>
          </div>
        </div>

        {/* Change photo */}
        <button onClick={() => showToast('Upload a new group photo')} style={{
          width:'100%', display:'flex', alignItems:'center', gap:11,
          background:'#fff', border:'none', borderRadius:16,
          boxShadow:'0 4px 14px rgba(16,24,40,0.05)', padding:'13px 15px',
          marginTop:12, cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
        }}>
          <div style={{ width:38, height:38, borderRadius:11, flexShrink:0,
                        background:'#E9F6FF', display:'flex', alignItems:'center',
                        justifyContent:'center' }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
              <rect x="3.5" y="6" width="17" height="13" rx="3" stroke={C.primary} strokeWidth="1.9"/>
              <circle cx="12" cy="12.5" r="3" stroke={C.primary} strokeWidth="1.9"/>
              <path d="M8.5 6l1-2h5l1 2" stroke={C.primary} strokeWidth="1.9" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ flex:1, textAlign:'left' }}>
            <div style={{ fontSize:14.5, fontWeight:700, color:C.ink }}>Change group photo</div>
            <div style={{ fontSize:12, color:C.subtle, marginTop:1 }}>Update cover &amp; avatar</div>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="m9 6 6 6-6 6" stroke="#C5CBD6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Analytics banner */}
        <button onClick={() => navigate('group-analytics', {groupId: g.id})} style={{
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
            <div style={{ fontSize:15, fontWeight:800, color:'#fff' }}>Group Analytics</div>
            <div style={{ fontSize:12, color:'rgba(255,255,255,0.85)', marginTop:1 }}>
              Engagement, revenue &amp; top contributors
            </div>
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="m9 6 6 6-6 6" stroke="rgba(255,255,255,0.9)" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Group Settings rows */}
        <div style={{ fontSize:16, fontWeight:800, color:C.ink, margin:'22px 4px 11px' }}>
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
        <div style={{ fontSize:16, fontWeight:800, color:C.ink, margin:'22px 4px 11px' }}>
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
                <div style={{ fontSize:13.5, fontWeight:700, color:C.ink }}>{a.title}</div>
                <div style={{ fontSize:11.5, color:C.subtle, marginTop:2 }}>{a.time}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Moderation */}
        <div style={{ fontSize:16, fontWeight:800, color:C.ink, margin:'22px 4px 11px' }}>
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
        <button onClick={() => showToast('Archive Group? This cannot be undone.')} style={{
          width:'100%', height:50, marginTop:18, border:`1.5px solid #FAD9D4`,
          borderRadius:15, background:'#fff', color:C.danger,
          fontSize:14.5, fontWeight:800, cursor:'pointer',
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
// SCREEN: PENDING REQUESTS
// ─────────────────────────────────────────────────────────────
function PendingRequestsScreen({ groupId, goBack, showToast }) {
  const INITIAL = [
    { id:1, name:'Priya Sharma',    initial:'P', color:'linear-gradient(135deg,#FF5A8A,#FF8A3D)',
      meta:'2nd year · Arts', time:'2h',
      note:'Love writing short fiction, would be great to join!' },
    { id:2, name:'Jordan Lee',      initial:'J', color:'linear-gradient(135deg,#19BFFF,#0078E0)',
      meta:'3rd year · Sciences', time:'5h', note:'' },
    { id:3, name:'Fatima Al-Rashid',initial:'F', color:'linear-gradient(135deg,#7C5CFF,#B06BFF)',
      meta:'1st year · Engineering', time:'1d',
      note:'Recommended by Sarah in the group.' },
    { id:4, name:'Marcus Bell',     initial:'M', color:'linear-gradient(135deg,#10B981,#06B6D4)',
      meta:'4th year · Business', time:'2d', note:'' },
  ];

  const [done, setDone] = useState({});
  const open = INITIAL.filter(r => !done[r.id]);

  const resolve = (id, msg) => {
    setDone(s => ({ ...s, [id]: true }));
    showToast(msg);
  };
  const acceptAll = () => {
    const all = {};
    INITIAL.forEach(r => { all[r.id] = true; });
    setDone(all);
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
        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Pending Requests</div>
        <div style={{ width:40 }}/>
      </div>

      {/* Bulk bar */}
      {open.length > 0 && (
        <div style={{ flexShrink:0, padding:'13px 16px 0',
                      display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:13, fontWeight:700, color:C.muted }}>
            {open.length} waiting to join
          </span>
          <button onClick={acceptAll} style={{
            height:34, padding:'0 14px', border:'none', borderRadius:11,
            background:'#E4F7EC', color:'#15A34A', fontSize:12.5, fontWeight:800,
            cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
          }}>Accept all</button>
        </div>
      )}

      {/* List */}
      <div style={{ flex:1, overflowY:'auto', padding:'13px 16px 30px',
                    display:'flex', flexDirection:'column', gap:12 }}>

        {open.length === 0 && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                        textAlign:'center', padding:'60px 30px' }}>
            <div style={{ width:78, height:78, borderRadius:24, background:'#E4F7EC',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
                <path d="m5 12.5 4 4L19 7" stroke="#15A34A" strokeWidth="2.4"
                      strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div style={{ fontSize:17, fontWeight:800, color:C.ink, marginTop:18 }}>
              No pending requests
            </div>
            <div style={{ fontSize:13, color:C.subtle, marginTop:6, maxWidth:230 }}>
              You're all caught up. New join requests will appear here.
            </div>
          </div>
        )}

        {open.map(r => (
          <div key={r.id} style={{ background:'#fff', borderRadius:18,
                                    boxShadow:'0 4px 14px rgba(16,24,40,0.05)', padding:14 }}>
            {/* Avatar + name */}
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ width:46, height:46, borderRadius:'50%', flexShrink:0,
                            background:r.color, display:'flex', alignItems:'center',
                            justifyContent:'center', fontSize:15, fontWeight:800,
                            color:'#fff', position:'relative', overflow:'hidden' }}>
                <span>{r.initial}</span>
                <div style={{ position:'absolute', inset:0, background:
                  'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 9px)'}}/>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14.5, fontWeight:800, color:C.ink }}>{r.name}</div>
                <div style={{ fontSize:11.5, color:C.subtle, marginTop:1 }}>{r.meta}</div>
              </div>
              <span style={{ fontSize:11, color:'#B6BCC8', flexShrink:0 }}>{r.time}</span>
            </div>

            {/* Note */}
            {r.note && (
              <div style={{ fontSize:12.5, color:C.muted, lineHeight:1.45,
                            background:'#F7F8FB', borderRadius:11,
                            padding:'10px 12px', marginTop:11 }}>
                "{r.note}"
              </div>
            )}

            {/* Actions */}
            <div style={{ display:'flex', gap:9, marginTop:12 }}>
              <button onClick={() => resolve(r.id, `${r.name} accepted`)} style={{
                flex:1, height:42, border:'none', borderRadius:12,
                background:'linear-gradient(135deg,#19BFFF,#008FF0)',
                color:'#fff', fontSize:13, fontWeight:800, cursor:'pointer',
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
              <button onClick={() => resolve(r.id, `${r.name} declined`)} style={{
                flex:1, height:42, border:`1.5px solid ${C.border}`, borderRadius:12,
                background:'#fff', color:C.muted, fontSize:13, fontWeight:800,
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
function BannedMembersScreen({ groupId, goBack, showToast }) {
  const INITIAL = [
    { id:1, name:'throwaway_99', initial:'T',
      color:'linear-gradient(135deg,#F59E0B,#EF4444)',
      when:'2 days ago', by:'You',
      reason:'Spam', detail:'Repeated promotional links after two warnings' },
    { id:2, name:'Mike Donovan', initial:'M',
      color:'linear-gradient(135deg,#0E1726,#3A4252)',
      when:'1 week ago', by:'Sarah L.',
      reason:'Harassment', detail:'Targeting other members in comments' },
  ];

  const [unbanned, setUnbanned] = useState({});
  const visible = INITIAL.filter(m => !unbanned[m.id]);

  const unban = (m) => {
    setUnbanned(s => ({ ...s, [m.id]: true }));
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
        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Banned Members</div>
        <div style={{ width:40 }}/>
      </div>

      {/* Body */}
      <div style={{ flex:1, overflowY:'auto', padding:'16px 16px 30px' }}>

        {visible.length > 0 && (
          <div style={{ fontSize:12.5, color:C.muted, lineHeight:1.55, marginBottom:14 }}>
            Banned members can't view, post, or join this group. You can lift a ban at any time.
          </div>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

          {visible.length === 0 && (
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
              <div style={{ fontSize:17, fontWeight:800, color:C.ink, marginTop:18 }}>
                No banned members
              </div>
              <div style={{ fontSize:13, color:C.subtle, marginTop:6, maxWidth:230 }}>
                Everyone's in good standing. Members you ban will appear here.
              </div>
            </div>
          )}

          {visible.map(m => (
            <div key={m.id} style={{ background:'#fff', borderRadius:18,
                                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)',
                                      padding:14 }}>
              {/* Avatar + name + unban */}
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:44, height:44, borderRadius:'50%', flexShrink:0,
                              background:m.color, display:'flex', alignItems:'center',
                              justifyContent:'center', fontSize:14, fontWeight:800,
                              color:'#fff', position:'relative', overflow:'hidden' }}>
                  <span>{m.initial}</span>
                  <div style={{ position:'absolute', inset:0, background:
                    'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 9px)'}}/>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14.5, fontWeight:800, color:C.ink }}>{m.name}</div>
                  <div style={{ fontSize:11.5, color:C.subtle, marginTop:1 }}>
                    Banned {m.when} · by {m.by}
                  </div>
                </div>
                <button onClick={() => unban(m)} style={{
                  flexShrink:0, height:36, padding:'0 15px',
                  border:`1.5px solid #BEE3FF`, borderRadius:11,
                  background:'#fff', color:C.primary,
                  fontSize:12.5, fontWeight:800, cursor:'pointer',
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
                <div style={{ fontSize:11.5, color:'#B43425', lineHeight:1.45 }}>
                  <span style={{ fontWeight:800 }}>{m.reason}</span> · {m.detail}
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
function GroupAnalyticsScreen({ groupId, goBack, showToast }) {
  const PERIODS = ['7 Days', '30 Days', '90 Days'];
  const DATA = {
    0: { bars:[58,72,90,76,100,40,34], labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
    1: { bars:[44,60,72,55,80,90,68],  labels:['W1','W2','W3','W4','W5','W6','W7'] },
    2: { bars:[30,52,48,70,62,85,100], labels:['Jan','Feb','Mar','Apr','May','Jun','Jul'] },
  };
  const KPIS = [
    { value:'2,847', label:'Active Users',     delta:'+12% this week', iconBg:'#E9F6FF', iconColor:C.primary,
      icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke={C.primary} strokeWidth="2"/><path d="M5 20c0-3.6 3-5.6 7-5.6s7 2 7 5.6" stroke={C.primary} strokeWidth="2" strokeLinecap="round"/></svg> },
    { value:'$18,420', label:'Revenue',        delta:'+8% this month',  iconBg:'#E4F7EC', iconColor:'#15A34A',
      icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3v18M16 7.5C16 5.6 14.2 4 12 4S8 5.6 8 7.5 9.8 11 12 11s4 1.6 4 3.5S14.2 18 12 18s-4-1.6-4-3.5" stroke="#15A34A" strokeWidth="2.2" strokeLinecap="round"/></svg> },
    { value:'15.2K',  label:'Total Likes',     delta:'+24% this week',  iconBg:'#FFF0F4', iconColor:'#FF5A8A',
      icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 20S4 15 4 9.5A3.8 3.8 0 0 1 12 7a3.8 3.8 0 0 1 8 2.5C20 15 12 20 12 20Z" stroke="#FF5A8A" strokeWidth="2" strokeLinejoin="round"/></svg> },
    { value:'3,891',  label:'Comments',        delta:'+18% this week',  iconBg:'#E9F6FF', iconColor:'#19BFFF',
      icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3.5V16.5H6a2 2 0 0 1-2-2Z" stroke="#19BFFF" strokeWidth="2" strokeLinejoin="round"/></svg> },
    { value:'56',     label:'New Posts',        delta:'+24% this week',  iconBg:'#F1ECFF', iconColor:'#7C5CFF',
      icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="3.5" width="16" height="17" rx="3" stroke="#7C5CFF" strokeWidth="2"/><path d="M8 9h8M8 13h8M8 17h5" stroke="#7C5CFF" strokeWidth="2" strokeLinecap="round"/></svg> },
    { value:'12',     label:'New Members',      delta:'+24% this week',  iconBg:'#E4F7EC', iconColor:'#10B981',
      icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="10" cy="8" r="3.2" stroke="#10B981" strokeWidth="2"/><path d="M4 20c0-3.4 2.7-5.3 6-5.3" stroke="#10B981" strokeWidth="2" strokeLinecap="round"/><path d="M18 13v6M15 16h6" stroke="#10B981" strokeWidth="2" strokeLinecap="round"/></svg> },
  ];
  const CONTRIBUTORS = [
    { name:'Alex Thompson', stats:'247 posts · 1.2K likes', initial:'A',
      color:'linear-gradient(135deg,#0E1726,#3A4252)', badge:'MVP',
      badgeBg:'#FFCF4D', badgeColor:'#7A5B00' },
    { name:'Maria Garcia', stats:'189 posts · 956 likes', initial:'M',
      color:'linear-gradient(135deg,#FF8A3D,#FF5A8A)', badge:'Star',
      badgeBg:'#E4E8EF', badgeColor:'#5B6473' },
    { name:'David Chen', stats:'156 posts · 743 likes', initial:'D',
      color:'linear-gradient(135deg,#19BFFF,#0078E0)', badge:'Rising',
      badgeBg:'#FAD9C2', badgeColor:'#B45309' },
  ];

  const [periodIdx, setPeriodIdx] = useState(0);
  const d   = DATA[periodIdx];
  const max = Math.max(...d.bars);

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
        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
                      letterSpacing:-0.3, color:C.ink }}>Group Analytics</div>
        <div style={{ width:40 }}/>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'16px 16px 30px' }}>

        {/* Engagement Overview */}
        <div style={{ background:'#fff', borderRadius:20,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)', padding:18 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                        marginBottom:18 }}>
            <span style={{ fontSize:16, fontWeight:800, color:C.ink }}>Engagement Overview</span>
            {/* Period picker */}
            <div style={{ display:'flex', gap:5 }}>
              {PERIODS.map((p, i) => (
                <button key={p} onClick={() => setPeriodIdx(i)} style={{
                  height:30, padding:'0 10px', border:'none', borderRadius:9,
                  fontSize:11.5, fontWeight:700, cursor:'pointer',
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
                <span style={{ fontSize:10, fontWeight:600, color:C.subtle }}>
                  {d.labels[i]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* KPI Grid */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:14 }}>
          {KPIS.map(k => (
            <div key={k.label} style={{ background:'#fff', borderRadius:18,
                                         boxShadow:'0 4px 14px rgba(16,24,40,0.05)',
                                         padding:'18px 16px', display:'flex',
                                         flexDirection:'column', alignItems:'center',
                                         textAlign:'center' }}>
              <div style={{ width:46, height:46, borderRadius:'50%', flexShrink:0,
                            background:k.iconBg, display:'flex', alignItems:'center',
                            justifyContent:'center' }}>{k.icon}</div>
              <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.8,
                            color:C.ink, marginTop:12 }}>{k.value}</div>
              <div style={{ fontSize:12, fontWeight:600, color:C.subtle,
                            marginTop:2 }}>{k.label}</div>
              <div style={{ fontSize:11.5, fontWeight:700, color:'#15A34A',
                            marginTop:6 }}>{k.delta}</div>
            </div>
          ))}
        </div>

        {/* Top Contributors */}
        <div style={{ background:'#fff', borderRadius:20,
                      boxShadow:'0 4px 16px rgba(16,24,40,0.06)',
                      padding:18, marginTop:14 }}>
          <div style={{ fontSize:16, fontWeight:800, color:C.ink, marginBottom:16 }}>
            Top Contributors
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {CONTRIBUTORS.map((c, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:40, height:40, borderRadius:'50%', flexShrink:0,
                              background:c.color, display:'flex', alignItems:'center',
                              justifyContent:'center', color:'#fff', fontSize:13,
                              fontWeight:800, position:'relative', overflow:'hidden' }}>
                  <span>{c.initial}</span>
                  <div style={{ position:'absolute', inset:0, background:
                    'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 9px)'}}/>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:C.ink }}>{c.name}</div>
                  <div style={{ fontSize:11.5, color:C.subtle, marginTop:1 }}>{c.stats}</div>
                </div>
                <span style={{ flexShrink:0, height:26, padding:'0 10px', borderRadius:999,
                               fontSize:11, fontWeight:800, display:'flex',
                               alignItems:'center', justifyContent:'center',
                               background:c.badgeBg, color:c.badgeColor }}>{c.badge}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Retention + Session */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginTop:14 }}>
          {[
            { value:'94.2%', label:'Retention Rate',
              icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 16l5-5 3 3 6-7" stroke={C.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M15 7h4v4" stroke={C.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
              iconBg:'#E9F6FF' },
            { value:'4.7h',  label:'Avg. Session',
              icon:<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="#F59E0B" strokeWidth="2"/><path d="M12 8v4.5l3 2" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
              iconBg:'#FFF6EC' },
          ].map(s => (
            <div key={s.label} style={{ background:'#fff', borderRadius:18,
                                         boxShadow:'0 4px 14px rgba(16,24,40,0.05)',
                                         padding:'18px 16px', display:'flex',
                                         flexDirection:'column', alignItems:'center',
                                         textAlign:'center' }}>
              <div style={{ width:46, height:46, borderRadius:'50%', background:s.iconBg,
                            display:'flex', alignItems:'center',
                            justifyContent:'center' }}>{s.icon}</div>
              <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.8,
                            color:C.ink, marginTop:12 }}>{s.value}</div>
              <div style={{ fontSize:12, fontWeight:600, color:C.subtle,
                            marginTop:2 }}>{s.label}</div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// SCREEN: GROUP EDIT
// ─────────────────────────────────────────────────────────────
function GroupEditScreen({ groupId, editTab, goBack, showToast }) {
  const g = GROUPS.find(gr => gr.id === groupId) || GROUPS[0];

  const TABS = ['Info','Privacy','Rules','Social'];
  const tabId = (t) => t.toLowerCase();

  const [tab,        setTab]        = useState(editTab || 'info');
  const [name,       setName]       = useState(g.name);
  const [desc,       setDesc]       = useState(g.desc || g.description || "");
  const [category,   setCategory]   = useState((g.cat || g.category || [])?.[0] || 'academic');
  const [visibility, setVisibility] = useState('public');
  const [perms,      setPerms]      = useState({ membersPost:true, requireApproval:false, allowInvites:true });
  const [rules,      setRules]      = useState(g.rules?.length ? [...g.rules] : ['Be respectful and constructive','Original work only — credit sources','No spam or self-promotion','Keep feedback kind and specific']);
  const [ruleDraft,  setRuleDraft]  = useState('');
  const [social,     setSocial]     = useState({ instagram:'@riply', tiktok:'', website:'riply.app', discord:'' });

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
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:0.4,
                    textTransform:'uppercase', color:C.subtle, marginBottom:7 }}>
        {label}
      </div>
      {children}
    </div>
  );

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
          <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
                        letterSpacing:-0.3, color:C.ink }}>Edit Group</div>
          <button onClick={() => { showToast('Changes saved'); goBack(); }} style={{
            height:40, padding:'0 16px', border:'none', borderRadius:13,
            background:'linear-gradient(135deg,#19BFFF,#008FF0)', color:'#fff',
            fontSize:13, fontWeight:800, cursor:'pointer',
            fontFamily:"'Montserrat',-apple-system,sans-serif",
            boxShadow:'0 4px 10px rgba(2,162,240,0.3)', flexShrink:0,
          }}>Save</button>
        </div>
        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:`1px solid ${C.divider}` }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(tabId(t))} style={{
              flex:1, height:38, border:'none', background:'none', cursor:'pointer',
              fontFamily:"'Montserrat',-apple-system,sans-serif",
              fontSize:13, fontWeight: tabId(t)===tab ? 800 : 600,
              color: tabId(t)===tab ? C.primary : C.subtle,
              borderBottom: `2.5px solid ${tabId(t)===tab ? C.primary : 'transparent'}`,
              marginBottom:-1,
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
              <button onClick={() => showToast('Upload a new group photo')} style={{
                position:'relative', border:'none', background:'none',
                cursor:'pointer', padding:0,
              }}>
                <div style={{ width:84, height:84, borderRadius:'50%',
                              background:g.logoColor || g.logo_color || "linear-gradient(135deg,#19BFFF,#0098F0)", display:'flex', alignItems:'center',
                              justifyContent:'center', color:'#fff', fontSize:26,
                              fontWeight:800, position:'relative', overflow:'hidden' }}>
                  <span>{g.initial || (g.name || "G")[0].toUpperCase()}</span>
                  <div style={{ position:'absolute', inset:0, background:
                    'repeating-linear-gradient(135deg,rgba(255,255,255,0.12) 0,rgba(255,255,255,0.12) 2px,transparent 2px,transparent 9px)'}}/>
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
              <div style={{ fontSize:12, fontWeight:700, color:C.primary, marginTop:9 }}>
                Change photo
              </div>
            </div>

            <Field label="Group Name">
              <input value={name} onChange={e => setName(e.target.value)}
                style={{ width:'100%', boxSizing:'border-box', height:48,
                         border:`1.5px solid ${C.border}`, borderRadius:14,
                         background:'#fff', padding:'0 14px', fontSize:15,
                         fontWeight:700, color:C.body, outline:'none',
                         fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
            </Field>

            <Field label="Description">
              <textarea value={desc} onChange={e => setDesc(e.target.value)}
                style={{ width:'100%', boxSizing:'border-box', minHeight:96,
                         border:`1.5px solid ${C.border}`, borderRadius:14,
                         background:'#fff', padding:13, fontSize:14, fontWeight:500,
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
                      fontSize:13, fontWeight:700,
                      fontFamily:"'Montserrat',-apple-system,sans-serif",
                      background: on ? C.primary : '#fff',
                      color: on ? '#fff' : C.muted,
                      boxShadow: on ? '0 4px 12px rgba(2,162,240,0.3)' : 'none',
                    }}>{c}</button>
                  );
                })}
              </div>
            </Field>
          </>
        )}

        {/* ── PRIVACY ── */}
        {tab === 'privacy' && (
          <>
            <div style={{ fontSize:13, color:C.muted, lineHeight:1.55, marginBottom:18 }}>
              Control who can find and join your group, and what members are allowed to do.
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {VIS.map(v => {
                const on  = visibility === v.id;
                const col = on ? C.primary : C.subtle;
                const iconWithColor = React.cloneElement(
                  v.icon,
                  {},
                  ...React.Children.map(v.icon.props.children, child =>
                    child ? React.cloneElement(child, { stroke: col }) : child
                  )
                );
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
                      <div style={{ fontSize:15, fontWeight:800, color:C.ink }}>{v.label}</div>
                      <div style={{ fontSize:12, color:C.subtle, marginTop:2 }}>{v.sub}</div>
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
                    <div style={{ fontSize:14, fontWeight:700, color:C.ink }}>{p.label}</div>
                    <div style={{ fontSize:11.5, color:C.subtle, marginTop:2 }}>{p.sub}</div>
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
                                justifyContent:'center', fontSize:12,
                                fontWeight:800, color:C.primary }}>{i+1}</div>
                  <span style={{ flex:1, fontSize:13, fontWeight:600, color:C.body,
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
                         background:'#fff', padding:'0 13px', fontSize:13,
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
                <div style={{ fontSize:11, fontWeight:700, letterSpacing:0.4,
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
                             fontSize:14, fontWeight:600, color:C.body,
                             fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>
                </div>
              </div>
            ))}
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
  const ev = EVENTS.find(e => e.id === eventId) || EVENTS[0];

  const ATTENDEES = [
    { name:'Maya Robinson',  initial:'MR', ticket:'General', color:'linear-gradient(135deg,#FF5A8A,#FF8A3D)', valid:true  },
    { name:'Liam Kowalski',  initial:'LK', ticket:'VIP',     color:'linear-gradient(135deg,#2F6BFF,#6C4DF2)', valid:true  },
    { name:'Aisha Nasser',   initial:'AN', ticket:'General', color:'linear-gradient(135deg,#10B981,#06B6D4)', valid:true  },
    { name:'Noah Park',      initial:'NP', ticket:'VIP',     color:'linear-gradient(135deg,#7C5CFF,#B06BFF)', valid:true  },
    { name:'Sofia Mendez',   initial:'SM', ticket:'General', color:'linear-gradient(135deg,#F59E0B,#EF4444)', valid:false, reason:'Already checked in' },
    { name:'Ethan Wong',     initial:'EW', ticket:'General', color:'linear-gradient(135deg,#0EA5E9,#0E84E0)', valid:true  },
  ];

  const [checkedIn, setCheckedIn] = useState(142);
  const total = 200;
  const [result,  setResult]  = useState(null);
  const [recent,  setRecent]  = useState([]);
  const [scanIdx, setScanIdx] = useState(0);

  const scan = () => {
    const a = ATTENDEES[scanIdx % ATTENDEES.length];
    setScanIdx(i => i + 1);
    setResult(a);
    if (a.valid) {
      setCheckedIn(n => Math.min(total, n + 1));
      setRecent(r => [{ ...a, time:'just now' }, ...r].slice(0, 6));
    }
    setTimeout(() => setResult(null), 1800);
  };

  const pct = Math.round((checkedIn / total) * 100);

  // faux QR cells
  const N = 17;
  const cells = Array.from({ length: N * N }, (_, idx) => {
    const r = Math.floor(idx / N), c = idx % N;
    const finder = (rr, cc) => rr < 5 && cc < 5;
    if (finder(r, c) || finder(r, N - 5 + (c < 5 ? 0 : N)) || finder(N - 5 + (r < 5 ? 0 : N), c)) {
      const lr = r % 5, lc = c % 5;
      return lr === 0 || lr === 4 || lc === 0 || lc === 4 || (lr >= 1 && lr <= 3 && lc >= 1 && lc <= 3);
    }
    return ((r * 7 + c * 13 + (r * c) % 5)) % 3 === 0;
  });

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
          <div style={{ fontSize:17, fontWeight:800, letterSpacing:-0.3, color:'#fff' }}>
            Check-In
          </div>
          <div style={{ fontSize:12, color:'rgba(255,255,255,0.55)', marginTop:1 }}>
            {ev.title} · Organizer
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(34,197,94,0.18)',
                      height:30, padding:'0 11px', borderRadius:999 }}>
          <span style={{ width:7, height:7, borderRadius:'50%', background:'#22C55E',
                         display:'block', flexShrink:0 }}/>
          <span style={{ fontSize:11.5, fontWeight:800, color:'#4ADE80' }}>Scanning</span>
        </div>
      </div>

      {/* Progress */}
      <div style={{ flexShrink:0, padding:'4px 18px 16px', position:'relative', zIndex:4 }}>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between',
                      marginBottom:9 }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
            <span style={{ fontSize:30, fontWeight:800, color:'#fff', letterSpacing:-1 }}>
              {checkedIn}
            </span>
            <span style={{ fontSize:15, fontWeight:600, color:'rgba(255,255,255,0.55)' }}>
              / {total} checked in
            </span>
          </div>
          <span style={{ fontSize:13, fontWeight:800, color:'#19BFFF' }}>{pct}%</span>
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
        {/* texture */}
        <div style={{ position:'absolute', inset:0, background:
          'repeating-linear-gradient(135deg,rgba(255,255,255,0.03) 0,rgba(255,255,255,0.03) 2px,transparent 2px,transparent 18px)'}}/>
        <div style={{ position:'absolute', top:14, left:'50%', transform:'translateX(-50%)',
                      fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:1,
                      color:'rgba(255,255,255,0.4)' }}>POINT AT ATTENDEE QR</div>

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
          {/* Faux QR */}
          <div style={{ position:'absolute', inset:30, opacity:0.22,
                        display:'grid', gridTemplateColumns:`repeat(${N},1fr)` }}>
            {cells.map((on, i) => (
              <div key={i} style={{ background: on ? '#19BFFF' : 'transparent',
                                    borderRadius:1 }}/>
            ))}
          </div>
          {/* Scan line */}
          <div style={{ position:'absolute', left:20, right:20, top:'50%',
                        height:2, background:'linear-gradient(90deg,transparent,#19BFFF,transparent)',
                        animation:'none', opacity:0.7 }}/>
        </div>

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
              <div style={{ fontSize:20, fontWeight:800, color:'#fff', marginTop:12 }}>
                {result.valid ? 'Valid Ticket' : 'Invalid'}
              </div>
              <div style={{ fontSize:15, fontWeight:700, color:'rgba(255,255,255,0.9)',
                            marginTop:5 }}>{result.name}</div>
              <div style={{ fontSize:12, color:'rgba(255,255,255,0.75)', marginTop:3 }}>
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
                              justifyContent:'center', fontSize:9, fontWeight:800,
                              color:'#fff' }}>{a.initial}</div>
                <span style={{ flex:1, fontSize:12, fontWeight:700, color:'rgba(255,255,255,0.9)' }}>
                  {a.name}
                </span>
                <span style={{ fontSize:10, fontWeight:600, color:'rgba(255,255,255,0.5)' }}>
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

      {/* Scan button */}
      <div style={{ flexShrink:0, display:'flex', justifyContent:'center',
                    padding:'18px 0 30px', zIndex:4 }}>
        <button onClick={scan} style={{
          display:'flex', alignItems:'center', gap:10, height:56, padding:'0 30px',
          border:'none', borderRadius:999, cursor:'pointer',
          background:'linear-gradient(135deg,#19BFFF,#008FF0)', color:'#fff',
          fontSize:16, fontWeight:800,
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          boxShadow:'0 10px 28px rgba(2,162,240,0.55)',
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"
                  stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
            <path d="M4 12h16" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Scan Ticket
        </button>
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
        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
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
        <div style={{ fontSize:22, fontWeight:800, letterSpacing:-0.5,
                      color:C.ink, marginTop:22 }}>Review posted!</div>
        <div style={{ fontSize:13.5, lineHeight:1.55, color:'#7B8499', marginTop:9,
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
          background:C.grad, color:'#fff', fontSize:16, fontWeight:800, cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          boxShadow:'0 8px 20px rgba(2,162,240,0.4)',
        }}>Discover more events</button>
        <button onClick={() => setSent(false)} style={{ border:'none', background:'none',
          cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
          fontSize:13.5, fontWeight:700, color:C.primary, marginTop:16 }}>
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
        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
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
                           fontSize:10, fontWeight:800, color:'#15A34A' }}>ATTENDED</span>
            <div style={{ fontSize:16, fontWeight:800, color:C.ink, marginTop:5 }}>
              {tk?.eventTitle || 'Karaoke Night'}
            </div>
            <div style={{ fontSize:11.5, color:C.subtle, marginTop:2 }}>
              {tk?.date || 'Jan 15, 2026'} · University Centre
            </div>
          </div>
        </div>

        {/* Overall rating */}
        <div style={{ textAlign:'center', marginTop:24 }}>
          <div style={{ fontSize:16, fontWeight:800, color:C.ink }}>How was the event?</div>
          <div style={{ display:'flex', justifyContent:'center', gap:6, marginTop:14 }}>
            {[1,2,3,4,5].map(n => (
              <Star key={n} filled={n<=rating} onClick={() => setRating(n)}/>
            ))}
          </div>
          <div style={{ fontSize:13, fontWeight:700, color:C.primary, marginTop:10, height:18 }}>
            {LABELS[rating]}
          </div>
        </div>

        {/* Aspect ratings */}
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:0.5,
                      textTransform:'uppercase', color:C.subtle,
                      margin:'22px 4px 10px' }}>Rate the details</div>
        <div style={{ background:'#fff', borderRadius:18,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)', overflow:'hidden' }}>
          {ASPECTS.map((a, i) => (
            <div key={a.id} style={{ display:'flex', alignItems:'center', gap:10,
                                      padding:'14px 15px',
                                      borderBottom: i<ASPECTS.length-1 ? `1px solid ${C.divider}` : 'none' }}>
              <span style={{ flex:1, fontSize:14, fontWeight:700, color:C.ink }}>
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
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:0.5,
                      textTransform:'uppercase', color:C.subtle,
                      margin:'22px 4px 10px' }}>What stood out?</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:9 }}>
          {TAGS.map(t => {
            const on = !!tags[t];
            return (
              <button key={t} onClick={() => setTags(s => ({ ...s, [t]: !s[t] }))} style={{
                border: on ? 'none' : `1.5px solid ${C.border}`,
                cursor:'pointer', height:38, padding:'0 16px', borderRadius:999,
                fontSize:13, fontWeight:700,
                fontFamily:"'Montserrat',-apple-system,sans-serif",
                background: on ? C.primary : '#fff',
                color: on ? '#fff' : C.muted,
                boxShadow: on ? '0 4px 12px rgba(2,162,240,0.3)' : 'none',
              }}>{t}</button>
            );
          })}
        </div>

        {/* Written review */}
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:0.5,
                      textTransform:'uppercase', color:C.subtle,
                      margin:'22px 4px 10px' }}>Your review</div>
        <textarea value={review} onChange={e => setReview(e.target.value)}
          placeholder="What did you love? What could be better?"
          style={{ width:'100%', boxSizing:'border-box', minHeight:100,
                   border:`1.5px solid ${C.border}`, borderRadius:16,
                   background:'#fff', padding:14, fontSize:13.5, fontWeight:500,
                   lineHeight:1.55, color:C.body, outline:'none', resize:'none',
                   fontFamily:"'Montserrat',-apple-system,sans-serif" }}/>

        {/* Recommend toggle */}
        <div style={{ display:'flex', alignItems:'center', gap:12, marginTop:16,
                      background:'#fff', borderRadius:16, padding:15,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:700, color:C.ink }}>
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
          fontSize:16, fontWeight:800, cursor: canSubmit ? 'pointer' : 'not-allowed',
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
function EventManagerScreen({ goBack, navigate, showToast }) {
  const TABS   = ['live','draft','past'];
  const MY_EVENTS = [
    { id:1, status:'live',  title:'Spring Career Fair 2026', when:'Jan 22 · 10:00 AM', day:'22', mon:'JAN', grad:'linear-gradient(135deg,#2F6BFF,#6C4DF2)', sales:'$12,800', rsvps:'1,280', views:'8.4K', sold:1280, cap:1500 },
    { id:2, status:'live',  title:'Karaoke Night',           when:'Jan 15 · 8:00 PM',  day:'15', mon:'JAN', grad:'linear-gradient(135deg,#FF5A8A,#FF8A3D)', sales:'Free',    rsvps:'540',   views:'3.1K', sold:540,  cap:600  },
    { id:3, status:'live',  title:'Founders Networking Mixer', when:'Jan 20 · 6:00 PM', day:'20', mon:'JAN', grad:'linear-gradient(135deg,#0EA5E9,#0E84E0)', sales:'$2,350',  rsvps:'180',   views:'1.6K', sold:180,  cap:200  },
    { id:4, status:'draft', title:'Spoken Word Open Mic',    when:'Not scheduled',      day:'—',  mon:'TBD', grad:'linear-gradient(135deg,#7C5CFF,#B06BFF)', sales:'—',      rsvps:'—',    views:'—',    sold:0,    cap:0    },
    { id:5, status:'past',  title:'Winter Welcome Social',   when:'Dec 4 · 7:00 PM',   day:'04', mon:'DEC', grad:'linear-gradient(135deg,#10B981,#06B6D4)', sales:'Free',    rsvps:'920',   views:'6.2K', sold:880,  cap:900  },
  ];

  const [tab,     setTab]     = useState('live');
  const [deleted, setDeleted] = useState({});
  const list = MY_EVENTS.filter(e => e.status === tab && !deleted[e.id]);

  const STATUS = {
    live:  { bg:'#E4F7EC', color:'#15A34A', text:'● Live'  },
    draft: { bg:'#FFF6EC', color:'#F59E0B', text:'Draft'   },
    past:  { bg:'#F1F3F7', color:'#7B8499', text:'Ended'   },
  };
  const EMPTY_WORD = { live:'live', draft:'draft', past:'past' };

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
        <div style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:800,
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
          {[{v:'$15.2K',label:'Ticket revenue'},{v:'2,000',label:'Total RSVPs'},{v:'13.1K',label:'Total views'}].map(s => (
            <div key={s.label} style={{ background:'#fff', borderRadius:16,
                                         boxShadow:'0 4px 14px rgba(16,24,40,0.05)',
                                         padding:'13px 8px', textAlign:'center' }}>
              <div style={{ fontSize:17, fontWeight:800, color:C.ink,
                            letterSpacing:-0.5 }}>{s.v}</div>
              <div style={{ fontSize:10.5, fontWeight:600, color:C.subtle,
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
            fontSize:13, fontWeight:700, textTransform:'capitalize',
            background: t===tab ? C.primary : '#fff',
            color: t===tab ? '#fff' : C.muted,
            boxShadow: t===tab ? '0 4px 12px rgba(2,162,240,0.3)' : '0 2px 8px rgba(16,24,40,0.04)',
          }}>{t.charAt(0).toUpperCase()+t.slice(1)}</button>
        ))}
      </div>

      {/* Event list */}
      <div style={{ flex:1, overflowY:'auto', padding:'10px 16px 30px',
                    display:'flex', flexDirection:'column', gap:14 }}>

        {list.length === 0 && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                        textAlign:'center', padding:'50px 30px' }}>
            <div style={{ width:74, height:74, borderRadius:22, background:'#EAF1F8',
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="#9AB4CC" strokeWidth="1.8"/>
                <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="#9AB4CC" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ fontSize:16, fontWeight:800, color:C.ink, marginTop:18 }}>
              No {EMPTY_WORD[tab]} events
            </div>
            <div style={{ fontSize:13, color:C.subtle, marginTop:6, maxWidth:230 }}>
              Create an event to start selling tickets and tracking attendance.
            </div>
          </div>
        )}

        {list.map(e => {
          const sm  = STATUS[e.status];
          const pct = e.cap > 0 ? Math.round((e.sold / e.cap) * 100) : 0;
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
                  <span style={{ position:'relative', fontSize:19, fontWeight:800, lineHeight:1 }}>
                    {e.day}
                  </span>
                  <span style={{ position:'relative', fontSize:10, fontWeight:700,
                                 letterSpacing:0.5, marginTop:2 }}>{e.mon}</span>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                    <span style={{ display:'inline-flex', alignItems:'center', height:22,
                                   padding:'0 10px', borderRadius:999, fontSize:11,
                                   fontWeight:800, background:sm.bg, color:sm.color }}>
                      {sm.text}
                    </span>
                  </div>
                  <div style={{ fontSize:14.5, fontWeight:800, color:C.ink,
                                marginTop:5, lineHeight:1.2 }}>{e.title}</div>
                  <div style={{ fontSize:12, color:C.subtle, marginTop:3 }}>{e.when}</div>
                </div>
              </div>

              {/* Metrics */}
              {e.cap > 0 && (
                <div style={{ padding:'0 14px 10px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between',
                                marginBottom:5 }}>
                    <span style={{ fontSize:11, fontWeight:700, color:C.subtle }}>
                      {e.sold}/{e.cap} tickets
                    </span>
                    <span style={{ fontSize:11, fontWeight:700, color:C.primary }}>
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
                {[{l:'Sales',v:e.sales},{l:'RSVPs',v:e.rsvps},{l:'Views',v:e.views}].map((s,i) => (
                  <div key={s.l} style={{ flex:1, textAlign:'center',
                                          borderRight: i<2 ? `1px solid ${C.divider}` : 'none',
                                          padding:'4px 0' }}>
                    <div style={{ fontSize:13.5, fontWeight:800, color:C.ink }}>{s.v}</div>
                    <div style={{ fontSize:10, fontWeight:600, color:C.subtle,
                                  marginTop:1 }}>{s.l}</div>
                  </div>
                ))}
              </div>

              {/* Action row */}
              <div style={{ display:'flex', gap:9, padding:'0 14px 14px' }}>
                {e.status === 'live' && (
                  <button onClick={() => navigate('check-in', {eventId: e.id})} style={{
                    flex:1, height:40, border:'none', borderRadius:12,
                    background:'#E9F6FF', color:C.primary,
                    fontSize:12.5, fontWeight:800, cursor:'pointer',
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
                <button onClick={() => navigate('create-event')} style={{
                  flex:1, height:40, border:'none', borderRadius:12,
                  background:'#F1F3F7', color:C.muted,
                  fontSize:12.5, fontWeight:800, cursor:'pointer',
                  fontFamily:"'Montserrat',-apple-system,sans-serif",
                  display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M5 19h3l9-9-3-3-9 9v3Z" stroke={C.muted} strokeWidth="1.9"
                          strokeLinejoin="round"/>
                  </svg>
                  Edit
                </button>
                <button onClick={() => setDeleted(s => ({ ...s, [e.id]: true }))} style={{
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
        <div style={{ flex:1, textAlign:'center', fontSize:16, fontWeight:800,
                      color:C.ink }}>Your Weekly Digest</div>
        <button onClick={() => showToast('Link copied')} style={{ width:40, height:40,
          border:'none', borderRadius:13, background:C.chip,
          display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0 }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <path d="M14 9V6.5a2 2 0 0 1 3.4-1.4l3.6 5a1.5 1.5 0 0 1 0 1.8l-3.6 5A2 2 0 0 1 14 15.5V13c-6 0-8 3-8 3s0-7 8-7Z"
                  stroke="#39414F" strokeWidth="1.8" strokeLinejoin="round"/>
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
            <span style={{ fontSize:12, fontWeight:800, letterSpacing:1,
                           color:'rgba(255,255,255,0.9)' }}>RIPLY · WEEKLY</span>
          </div>
          <div style={{ position:'relative', fontSize:23, fontWeight:800, letterSpacing:-0.5,
                        color:'#fff', marginTop:16, lineHeight:1.2 }}>
            Hey Jane — here's what's happening on campus this week 👋
          </div>
          <div style={{ position:'relative', fontSize:13, color:'rgba(255,255,255,0.85)',
                        marginTop:8 }}>
            Jun 21 – Jun 27 · Personalized for you
          </div>
        </div>

        {/* Stats card */}
        <div style={{ margin:'-16px 16px 0', background:'#fff', borderRadius:20,
                      padding:16, boxShadow:'0 6px 18px rgba(16,24,40,0.08)',
                      position:'relative' }}>
          <div style={{ fontSize:13, fontWeight:800, color:C.ink, marginBottom:12 }}>
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
                <div style={{ fontSize:22, fontWeight:800, color:s.color,
                              letterSpacing:-0.5 }}>{s.v}</div>
                <div style={{ fontSize:10.5, fontWeight:600, color:C.subtle,
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
            <span style={{ fontSize:16, fontWeight:800, color:C.ink }}>Picked for you</span>
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
                  <span style={{ display:'inline-block', fontSize:10, fontWeight:800,
                                 letterSpacing:0.4, color:p.reasonColor,
                                 background:p.reasonBg, padding:'3px 8px',
                                 borderRadius:6 }}>{p.reason}</span>
                  <div style={{ fontSize:14.5, fontWeight:800, color:C.ink, marginTop:5,
                                lineHeight:1.2 }}>{p.title}</div>
                  <div style={{ fontSize:12, fontWeight:600, color:C.primary,
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
            <span style={{ fontSize:16, fontWeight:800, color:C.ink }}>Trending this week</span>
          </div>
          <div style={{ background:'#fff', borderRadius:18, padding:'4px 16px',
                        boxShadow:'0 4px 14px rgba(16,24,40,0.05)' }}>
            {TRENDING.map((t, i) => (
              <div key={i} onClick={() => navigate('event-details', {eventId: t.eventId})}
                style={{ display:'flex', alignItems:'center', gap:13, padding:'13px 0',
                         borderBottom: i<TRENDING.length-1 ? `1px solid ${C.divider}` : 'none',
                         cursor:'pointer' }}>
                <span style={{ fontSize:17, fontWeight:800, color:'#D4D9E2', width:18 }}>
                  {i+1}
                </span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:C.ink,
                                whiteSpace:'nowrap', overflow:'hidden',
                                textOverflow:'ellipsis' }}>{t.title}</div>
                  <div style={{ fontSize:11.5, color:C.subtle,
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
              <div style={{ fontSize:11, fontWeight:800, letterSpacing:1,
                            color:'#19BFFF' }}>GROUP SPOTLIGHT</div>
              <div style={{ fontSize:18, fontWeight:800, color:'#fff',
                            marginTop:8 }}>Photography Collective</div>
              <div style={{ fontSize:12.5, lineHeight:1.5,
                            color:'rgba(255,255,255,0.7)', marginTop:6 }}>
                320 students sharing campus shots, weekly photo walks, and gear swaps.
                Spots are filling fast for the spring exhibition.
              </div>
              <button onClick={() => navigate('group-profile', {groupId: 4})} style={{
                display:'inline-flex', alignItems:'center', gap:7, marginTop:14,
                height:40, padding:'0 18px', border:'none', borderRadius:999,
                background:'#19BFFF', color:'#fff', fontSize:13, fontWeight:800,
                cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
              }}>Join the club</button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign:'center', padding:'26px 30px 0' }}>
          <div style={{ fontSize:12.5, color:C.subtle, lineHeight:1.5 }}>
            You're receiving this because you're part of campus life on Riply.
          </div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
                        gap:6, marginTop:8 }}>
            <span onClick={() => showToast('Digest settings')}
              style={{ fontSize:12.5, fontWeight:700, color:C.primary, cursor:'pointer' }}>
              Digest settings
            </span>
            <span style={{ color:C.divider }}>·</span>
            <span onClick={() => showToast('Unsubscribed from weekly digest')}
              style={{ fontSize:12.5, fontWeight:700, color:C.subtle, cursor:'pointer' }}>
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
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    setPaying(false);
    if (error) { onError(error.message); } else { onSuccess(); }
  };

  return (
    <form onSubmit={handleSubmit} style={{ width:'100%' }}>
      <PaymentElement options={{ layout: 'tabs' }} />
      <button type="submit" disabled={!stripe || paying} style={{
        width:'100%', height:52, marginTop:16, border:'none', borderRadius:16, cursor:'pointer',
        background: (!stripe||paying) ? '#C5CBD6' : 'linear-gradient(135deg,#19BFFF,#008FF0)',
        color:'#fff', fontSize:14, fontWeight:800,
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
  const ev = EVENTS.find(e => e.id === eventId) || EVENTS[0];

  const VIP_PRICE = 49.99;
  const FEE_PER   = 2.50;
  const TAX_RATE  = 0.05;

  const TICKET_TYPES = [
    { id:'general', name:'General Admission', desc:'Standing room · general access',     price:0 },
    { id:'vip',     name:'VIP Experience',    desc:'Premium seating · backstage access', price:VIP_PRICE },
  ];

  const [step,          setStep]          = useState('purchase'); // purchase | stripe | processing | success | failed
  const [ticket,        setTicket]        = useState('general');
  const [qty,           setQty]           = useState(1);
  const [clientSecret,  setClientSecret]  = useState(null);
  const [stripeError,   setStripeError]   = useState(null);

  // ── pricing helpers ─────────────────────────────────────────
  const isFree    = ticket === 'general' || ev.price === 'Free' || ev.price === 0;
  const unitPrice = isFree ? 0 : VIP_PRICE;
  const subtotal  = unitPrice * qty;
  const fee       = isFree ? 0 : FEE_PER * qty;
  const tax       = isFree ? 0 : +((subtotal + fee) * TAX_RATE).toFixed(2);
  const total     = subtotal + fee + tax;
  const money     = (n) => '$' + n.toFixed(2);
  const totalLabel = isFree ? 'Free' : money(total);

  // ── save ticket to Supabase after success ──────────────────
  const saveTicket = async () => {
    if (!user?.id) return;
    await supabase.from('tickets').insert({
      user_id:   user.id,
      event_id:  ev.id,
      title:     ev.title,
      access:    ticket === 'vip' ? 'VIP Experience' : 'General Admission',
      price:     total,
      status:    'ACTIVE',
      date:      ev.fullDate || ev.date,
      time:      ev.timeRange || ev.date,
      location:  ev.location,
    });
  };

  // ── proceed → free RSVP or create Stripe PaymentIntent ─────
  const proceed = async () => {
    if (isFree) {
      setStep('processing');
      await saveTicket();
      setStep('success');
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
  const th = THEME[ev.primary] || THEME.social;

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
        <div style={{ fontSize:17, fontWeight:800, color:C.ink }}>Processing payment…</div>
        <div style={{ fontSize:13, color:C.subtle, marginTop:6 }}>
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
        <div style={{ fontSize:22, fontWeight:800, letterSpacing:-0.5,
                      color:C.ink, marginTop:20 }}>
          {isFree ? 'Spot reserved!' : 'Payment confirmed!'}
        </div>
        <div style={{ fontSize:13.5, lineHeight:1.55, color:'#7B8499',
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
                <div style={{ fontSize:16, fontWeight:800, color:C.ink }}>{ev.title}</div>
                <div style={{ fontSize:12, fontWeight:600, color:C.primary, marginTop:3 }}>
                  {ev.fullDate}
                </div>
                <div style={{ fontSize:11.5, color:C.subtle, marginTop:1 }}>
                  {ev.venue} · {ev.room}
                </div>
              </div>
            </div>
            <div style={{ marginTop:14, paddingTop:14, borderTop:`1px dashed ${C.divider}`,
                          display:'flex', justifyContent:'space-between' }}>
              <div>
                <div style={{ fontSize:10.5, fontWeight:700, color:C.subtle,
                              textTransform:'uppercase', letterSpacing:0.3 }}>Ticket type</div>
                <div style={{ fontSize:13, fontWeight:700, color:C.body, marginTop:3 }}>
                  {ticket === 'vip' ? 'VIP Experience' : 'General Admission'} × {qty}
                </div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:10.5, fontWeight:700, color:C.subtle,
                              textTransform:'uppercase', letterSpacing:0.3 }}>Total paid</div>
                <div style={{ fontSize:15, fontWeight:800, color:C.ink, marginTop:3 }}>
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
            background:'#fff', fontSize:13, fontWeight:700, color:C.body,
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
            background:C.grad, fontSize:13, fontWeight:800, color:'#fff',
            cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
            boxShadow:'0 6px 16px rgba(2,162,240,0.32)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M4 8.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 1.8 1.8 0 0 0 0 3.4A1.8 1.8 0 0 0 20 15.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 1.8 1.8 0 0 0 0-3.6A1.8 1.8 0 0 0 4 8.5Z"
                    stroke="#fff" strokeWidth="1.8" strokeLinejoin="round"/>
            </svg>
            View Ticket
          </button>
        </div>
        <button onClick={goBack} style={{ border:'none', background:'none', cursor:'pointer',
          fontFamily:"'Montserrat',-apple-system,sans-serif",
          fontSize:13.5, fontWeight:700, color:C.primary, marginTop:16 }}>
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
        <div style={{ fontSize:22, fontWeight:800, letterSpacing:-0.5,
                      color:C.ink, marginTop:20 }}>Payment failed</div>
        <div style={{ fontSize:13.5, lineHeight:1.55, color:'#7B8499',
                      textAlign:'center', marginTop:8, maxWidth:280 }}>
          {stripeError || `We couldn't process your payment of `}
          {!stripeError && <><span style={{ fontWeight:700, color:C.ink }}>{money(total)}</span>. Please try again.</>}
        </div>
        <div style={{ width:'100%', background:'#fff', borderRadius:16,
                      boxShadow:'0 4px 14px rgba(16,24,40,0.06)',
                      padding:16, marginTop:24 }}>
          <div style={{ fontSize:13, fontWeight:800, color:C.ink, marginBottom:12 }}>
            This can happen because of:
          </div>
          {['Insufficient funds','Incorrect card details or expired card',
            'Bank security restrictions'].map((r,i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10,
                                   marginBottom: i<2 ? 10 : 0 }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:'#9AA3B2',
                             flexShrink:0 }}/>
              <span style={{ fontSize:13, color:'#5B6473' }}>{r}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flexShrink:0, padding:'8px 20px 30px',
                    display:'flex', flexDirection:'column', gap:11 }}>
        <button onClick={proceed} style={{
          width:'100%', height:52, border:'none', borderRadius:16,
          background:C.grad, color:'#fff', fontSize:16, fontWeight:800,
          cursor:'pointer', fontFamily:"'Montserrat',-apple-system,sans-serif",
          boxShadow:'0 8px 20px rgba(2,162,240,0.4)',
        }}>Try Again</button>
        <button onClick={() => showToast('Update your payment method in Settings')} style={{
          width:'100%', height:52, border:`1.5px solid ${C.primary}`,
          borderRadius:16, background:'#fff', color:C.primary,
          fontSize:15, fontWeight:800, cursor:'pointer',
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
        <span style={{ fontSize:19, fontWeight:800, letterSpacing:-0.4, color:C.ink }}>Payment</span>
        <span style={{ marginLeft:'auto', fontSize:16, fontWeight:800, color:C.primary }}>{money(total)}</span>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'0 16px 40px' }}>
        <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme:'stripe' } }}>
          <StripePaymentForm
            total={total}
            onSuccess={async () => { await saveTicket(); setStep('success'); }}
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
        <span style={{ flex:1, textAlign:'center', fontSize:15,
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
            <span style={{ fontSize:22, fontWeight:800, letterSpacing:-0.5,
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
              <div style={{ position:'absolute', inset:0, background:
                'repeating-linear-gradient(135deg,rgba(255,255,255,0.14) 0,rgba(255,255,255,0.14) 2px,transparent 2px,transparent 10px)'}}/>
            </div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:16, fontWeight:800, color:C.ink,
                            letterSpacing:-0.3 }}>{ev.title}</div>
              <div style={{ fontSize:12.5, fontWeight:600, color:C.primary,
                            marginTop:4 }}>{ev.fullDate}</div>
              <div style={{ fontSize:12, color:C.subtle, marginTop:2 }}>
                {ev.venue}
              </div>
            </div>
          </div>

          {/* Ticket types */}
          <div style={{ fontSize:16, fontWeight:800, color:C.ink, marginTop:20 }}>
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
                    <div style={{ fontSize:15.5, fontWeight:800, color:C.ink }}>{t.name}</div>
                    <div style={{ fontSize:12.5, color:C.subtle, marginTop:3 }}>{t.desc}</div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:11, flexShrink:0 }}>
                    <span style={{ fontSize:15, fontWeight:800,
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
            <span style={{ fontSize:16, fontWeight:800, color:C.ink }}>Quantity</span>
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
              <span style={{ fontSize:18, fontWeight:800, color:C.ink,
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
                <span style={{ fontSize:13.5, fontWeight:500, color:'#7B8499' }}>
                  {r.label}
                </span>
                <span style={{ fontSize:13.5, fontWeight:700, color:'#1A2233' }}>
                  {r.val}
                </span>
              </div>
            ))}
          </div>

          {/* Total */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                        marginTop:15, paddingTop:15, borderTop:`1px solid ${C.divider}` }}>
            <span style={{ fontSize:18, fontWeight:800, color:C.ink }}>Total</span>
            <span style={{ fontSize:20, fontWeight:800, color:C.primary }}>
              {totalLabel}
            </span>
          </div>
        </div>

        {/* Sticky CTA */}
        <div style={{ flexShrink:0, padding:'14px 18px 26px', background:'#F4F6FA' }}>
          <button onClick={proceed} style={{
            width:'100%', height:54, border:'none', borderRadius:16,
            background:C.grad, color:'#fff', fontSize:16, fontWeight:800,
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

export default function RiplyApp() {
  const { signIn, setActive: setActiveSignIn, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setActiveSignUp } = useSignUp();
  const currentUser = useCurrentUser();
  const notifs = useNotifications();

  // Expose to auth screens
  useEffect(() => {
    window._clerkSignIn = signIn;
    window._clerkSignUp = signUp;
    window._clerkSetActive = setActiveSignIn;
    window._clerkSetActiveSignUp = setActiveSignUp;
  }, [signIn, signUp, setActiveSignIn, setActiveSignUp]);
  // Font injection
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = "@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap');@keyframes riplyPulse{0%{transform:scale(.7);opacity:.9}70%{transform:scale(2.4);opacity:0}100%{opacity:0}}*::-webkit-scrollbar{display:none;}";
    document.head.appendChild(style);
    return () => { if(document.head.contains(style)) document.head.removeChild(style); };
  }, []);

  // Navigation stack
  const [navStack, setNavStack] = useState([{ screen: 'welcome' }]);

  // Auth guard: once Clerk loads, route to the right place.
  // Wait for profileLoading to finish — if authenticated but no Supabase profile yet,
  // the user is mid-onboarding (just verified email); don't skip to home.
  useEffect(() => {
    if (!currentUser.isLoaded || currentUser.profileLoading) return;
    const current = navStack[navStack.length - 1].screen;
    const authScreens = ['welcome', 'auth'];
    if (currentUser.isAuthenticated && currentUser.profile && authScreens.includes(current)) {
      setNavStack([{ screen: 'home' }]);
    }
    if (!currentUser.isAuthenticated && !authScreens.includes(current)) {
      setNavStack([{ screen: 'welcome' }]);
    }
  }, [currentUser.isLoaded, currentUser.profileLoading, currentUser.isAuthenticated, currentUser.profile]);

  // Request FCM push permission once the user is authenticated
  useEffect(() => {
    if (!currentUser.isAuthenticated || !currentUser.userId) return;
    if (!('Notification' in window) || !import.meta.env.VITE_FIREBASE_API_KEY) return;
    import('./lib/firebase.js').then(({ requestNotificationPermission }) => {
      requestNotificationPermission(currentUser.userId, currentUser.updateProfile);
    });
  }, [currentUser.isAuthenticated, currentUser.userId]);
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
  const { liked, saved, rsvpd: following, postLiked, toggleLike, toggleSave, toggleRsvp: toggleFollowing, togglePostLike } = useUserInteractions();
  const [filters, setFilters] = useState({});
  const [activeCat, setActiveCat] = useState('trending');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [role, setRole] = useState('student');

  // Spaces state
  const [spaceTab, setSpaceTab] = useState('today');
  const [spaceJoined, setSpaceJoined] = useState({});
  const [spaceNotify, setSpaceNotify] = useState({});
  const [progress, setProgress] = useState({ 2:24, 4:8 });

  // Discover state
  const [discoverTab, setDiscoverTab] = useState('popular');
  const [groupJoined, setGroupJoined] = useState({});

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
      case 'welcome':   return <WelcomeScreen navigate={navigate} setScreen={setScreen} />;
      case 'auth':      return <AuthScreen setScreen={setScreen} showToast={showToast} initialStep={navParams.initialStep} initialRole={navParams.role} />;
      case 'home':      return <HomeScreen liked={liked} toggleLike={toggleLike} saved={saved} toggleSave={toggleSave} following={following} toggleFollowing={toggleFollowing} filters={filters} setFilters={setFilters} activeCat={activeCat} setActiveCat={setActiveCat} query={query} setQuery={setQuery} createOpen={createOpen} setCreateOpen={setCreateOpen} role={role} setRole={setRole} navigate={navigate} showToast={showToast} />;
      case 'spaces':    return <SpacesScreen spaceTab={spaceTab} setSpaceTab={setSpaceTab} spaceJoined={spaceJoined} setSpaceJoined={setSpaceJoined} spaceNotify={spaceNotify} setSpaceNotify={setSpaceNotify} progress={progress} navigate={navigate} showToast={showToast} />;
      case 'discover':  return <DiscoverScreen discoverTab={discoverTab} setDiscoverTab={setDiscoverTab} groupJoined={groupJoined} setGroupJoined={setGroupJoined} navigate={navigate} showToast={showToast} />;
      case 'messages':  return <MessagesScreen msgTab={msgTab} setMsgTab={setMsgTab} navigate={navigate} showToast={showToast} notifs={notifs} />;
      case 'profile':   return <ProfileScreen navigate={navigate} showToast={showToast} currentUser={currentUser} />;
      case 'create-event': return <CreateEventScreen goBack={goBack} navigate={navigate} showToast={showToast} currentUser={currentUser} />;
      case 'my-tickets':   return <MyTicketsScreen goBack={goBack} navigate={navigate} showToast={showToast} />;
      case 'create-space':  return <CreateSpaceScreen goBack={goBack} navigate={navigate} showToast={showToast} currentUser={currentUser} />;
      case 'create-group':  return <CreateGroupScreen goBack={goBack} navigate={navigate} showToast={showToast} currentUser={currentUser} />;
      case 'chat':          return <ChatScreen chatId={navParams.chatId} goBack={goBack} showToast={showToast} currentUser={currentUser} />;
      case 'event-details': return <EventDetailsScreen eventId={navParams.eventId} liked={liked} toggleLike={toggleLike} saved={saved} toggleSave={toggleSave} following={following} toggleFollowing={toggleFollowing} navigate={navigate} goBack={goBack} showToast={showToast} role={role} />;
      case 'space-details': return <SpaceDetailsScreen spaceId={navParams.spaceId} goBack={goBack} navigate={navigate} showToast={showToast} />;
      case 'group-profile':  return <GroupProfileScreen groupId={navParams.groupId} postLiked={postLiked} togglePostLike={togglePostLike} goBack={goBack} navigate={navigate} showToast={showToast} />;
      case 'filters':       return <FiltersScreen from={navParams.from} filters={navParams.filters} setFilters={navParams.setFilters} goBack={goBack} showToast={showToast} />;
      case 'create-post':   return <CreatePostScreen goBack={goBack} groupId={navParams.groupId} showToast={showToast} />;
      case 'help-center':   return <HelpCenterScreen goBack={goBack} navigate={navigate} showToast={showToast} />;
      case 'feedback':      return <FeedbackScreen goBack={goBack} showToast={showToast} />;
      case 'legal':         return <LegalScreen goBack={goBack} showToast={showToast} />;
      case 'about':         return <AboutScreen goBack={goBack} navigate={navigate} showToast={showToast} />;
      case 'check-in':      return <CheckInScreen eventId={navParams.eventId} goBack={goBack} showToast={showToast} />;
      case 'review':        return <ReviewScreen ticketId={navParams.ticketId} goBack={goBack} navigate={navigate} showToast={showToast} />;
      case 'tickets':       return <TicketsScreen eventId={navParams.eventId} goBack={goBack} navigate={navigate} showToast={showToast} />;
      case 'group-manage':  return <GroupManageScreen groupId={navParams.groupId} goBack={goBack} navigate={navigate} showToast={showToast} />;
      case 'pending-requests': return <PendingRequestsScreen groupId={navParams.groupId} goBack={goBack} showToast={showToast} />;
      case 'banned-members':   return <BannedMembersScreen groupId={navParams.groupId} goBack={goBack} showToast={showToast} />;
      case 'group-analytics':  return <GroupAnalyticsScreen groupId={navParams.groupId} goBack={goBack} showToast={showToast} />;
      case 'group-edit':       return <GroupEditScreen groupId={navParams.groupId} editTab={navParams.editTab} goBack={goBack} showToast={showToast} />;
      case 'event-manager': return <EventManagerScreen goBack={goBack} navigate={navigate} showToast={showToast} />;
      case 'weekly-digest': return <WeeklyDigestScreen goBack={goBack} navigate={navigate} showToast={showToast} />;
      default:          return <HomeScreen liked={liked} toggleLike={toggleLike} saved={saved} toggleSave={toggleSave} following={following} toggleFollowing={toggleFollowing} filters={filters} setFilters={setFilters} activeCat={activeCat} setActiveCat={setActiveCat} query={query} setQuery={setQuery} createOpen={createOpen} setCreateOpen={setCreateOpen} role={role} setRole={setRole} navigate={navigate} showToast={showToast} />;
    }
  };

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#E9ECF2', padding:32, boxSizing:'border-box', fontFamily:"'Montserrat',-apple-system,sans-serif" }}>
      <div style={{ width:402, height:874, borderRadius:48, overflow:'hidden', position:'relative', background:C.pageBg, boxShadow:'0 40px 80px rgba(0,0,0,0.18),0 0 0 1px rgba(0,0,0,0.12)', flexShrink:0 }}>
        <div style={{ height:'100%' }}>
          {renderScreen()}
        </div>
        {toast && <Toast msg={toast} />}
        {showBottomNav && <BottomNav screen={screen} setScreen={setScreen} unreadCount={notifs.unreadCount} />}
        <div style={{ position:'absolute', bottom:0, left:0, right:0, zIndex:60, height:34, display:'flex', justifyContent:'center', alignItems:'flex-end', paddingBottom:8, pointerEvents:'none' }}>
          <div style={{ width:139, height:5, borderRadius:100, background:'rgba(0,0,0,0.25)' }} />
        </div>
      </div>
    </div>
  );
}
