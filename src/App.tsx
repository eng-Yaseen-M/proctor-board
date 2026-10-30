import { useState, useEffect, useMemo } from 'react'
import { supabase, type ProctorUser } from './lib/supabase'
import './index.css'

// ========== Types ==========
interface Person {
  full: string
  name: string
  college: string
}

interface Assignment {
  day: string
  period: string
  time: string
  hall: string
  exam_college: string
  name: string
  college: string
  full_name: string
  is_responsible: boolean
  colleagues: string[]
}

interface Conflict {
  person: string
  day: string
  period: string
  halls: string[]
}

interface ScheduleData {
  assignments: Assignment[]
  people: Person[]
  conflicts: Conflict[]
  college_map: Record<string, string>
  control_rooms: Record<string, string>
  source?: string
  fetched_at?: string
}

// ========== Helpers ==========
const COLLEGE_COLORS: Record<string, string> = {
  CS: 'var(--cs)',
  ART: 'var(--art)',
  V: 'var(--v)',
  MEDIA: 'var(--media)',
  L: 'var(--l)',
  LAW: 'var(--law)',
  H: 'var(--h)',
  NUR: 'var(--nur)',
}

const DAY_ORDER: Record<string, number> = {
  'السبت 31/10': 1,
  'الأحد 1/11': 2,
  'الاثنين 2/11': 3,
  'الثلاثاء 3/11': 4,
  'الأربعاء 4/11': 5,
  'الخميس 5/11': 6,
  'السبت 7/11': 7,
}

function groupByDay(assignments: Assignment[]) {
  const map = new Map<string, Assignment[]>()
  for (const a of assignments) {
    if (!map.has(a.day)) map.set(a.day, [])
    map.get(a.day)!.push(a)
  }
  return Array.from(map.entries()).sort(
    (a, b) => (DAY_ORDER[a[0]] ?? 99) - (DAY_ORDER[b[0]] ?? 99)
  )
}

const STORAGE_KEY = 'proctor_user'

// ========== Login Screen ==========
function LoginScreen({ onLogin }: { onLogin: (u: ProctorUser) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    const n = name.trim()
    const em = email.trim().toLowerCase()
    if (!n || !em) {
      setErr('الاسم والإيميل مطلوبين')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setErr('الإيميل غير صحيح')
      return
    }

    setLoading(true)
    try {
      // Save to Supabase (upsert by email)
      const { error } = await supabase.from('proctors').upsert(
        { name: n, email: em, updated_at: new Date().toISOString() },
        { onConflict: 'email' }
      )
      if (error) {
        // If table missing or offline, still allow local login
        console.warn('Supabase:', error.message)
      }

      const user: ProctorUser = { name: n, email: em }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
      onLogin(user)
    } catch (e: any) {
      // Offline / no supabase configured → local only
      const user: ProctorUser = { name: n, email: em }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
      onLogin(user)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img
          src="/logo-humanities.jpeg"
          alt="كلية الإنسانيات"
          className="login-logo"
        />
        <h1>لوحة المراقبة</h1>
        <p className="login-sub">امتحانات منتصف الترم · 2026</p>

        <form onSubmit={handleSubmit} className="login-form">
          <label>
            الاسم
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="اكتب اسمك الكامل"
              autoFocus
              autoComplete="name"
            />
          </label>
          <label>
            الإيميل
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              autoComplete="email"
              dir="ltr"
            />
          </label>
          {err && <p className="login-error">{err}</p>}
          <button type="submit" disabled={loading}>
            {loading ? 'جاري الدخول...' : 'دخول'}
          </button>
        </form>
        <p className="login-note">
          هيتم حفظ بياناتك عشان نبعتلك إشعار لو حصل تحديث في الجدول
        </p>
      </div>
    </div>
  )
}

// ========== Main App ==========
function App() {
  const [user, setUser] = useState<ProctorUser | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  const [data, setData] = useState<ScheduleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Person | null>(null)
  const [checking, setChecking] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)

  // Restore user from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setUser(JSON.parse(raw))
    } catch {}
    setAuthChecked(true)
  }, [])

  // Load schedule data
  useEffect(() => {
    if (!user) return
    async function load() {
      try {
        let r = await fetch('/api/schedule', { cache: 'no-store' })
        if (!r.ok) r = await fetch('/schedule.json')
        if (!r.ok) throw new Error('فشل تحميل البيانات')
        const d: ScheduleData = await r.json()
        setData(d)
      } catch (e: any) {
        try {
          const r = await fetch('/schedule.json')
          setData(await r.json())
        } catch {
          setError(e.message || 'خطأ غير معروف')
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user])

  const matches = useMemo(() => {
    if (!data || !query.trim()) return []
    const q = query.trim().toLowerCase()
    return data.people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.full.toLowerCase().includes(q) ||
        p.college.toLowerCase().includes(q)
    )
  }, [data, query])

  const schedule = useMemo(() => {
    if (!data || !selected) return []
    return data.assignments
      .filter((a) => a.full_name === selected.full)
      .sort((a, b) => {
        const d = (DAY_ORDER[a.day] ?? 99) - (DAY_ORDER[b.day] ?? 99)
        if (d !== 0) return d
        return a.period.localeCompare(b.period)
      })
  }, [data, selected])

  const personConflicts = useMemo(() => {
    if (!data || !selected) return []
    return data.conflicts.filter((c) => c.person === selected.full)
  }, [data, selected])

  const hasConflict = (a: Assignment) =>
    personConflicts.some((c) => c.day === a.day && c.period === a.period)

  async function checkUpdates() {
    setChecking(true)
    setUpdateMsg(null)
    try {
      const res = await fetch('/api/schedule?check=1', { cache: 'no-store' })
      if (res.ok) {
        const live = await res.json()
        if (live.assignments?.length && data) {
          if (live.assignments.length !== data.assignments.length) {
            setUpdateMsg(
              `تم رصد تحديث! (كان ${data.assignments.length} أصبح ${live.assignments.length})`
            )
            setData(live)
          } else {
            setUpdateMsg('الجدول محدّث بالفعل ✓')
          }
        }
      } else {
        setUpdateMsg('لا يمكن التحقق الآن. البيانات الحالية من آخر سحب.')
      }
    } catch {
      setUpdateMsg('تعذر الاتصال. استخدم البيانات المحلية.')
    } finally {
      setChecking(false)
      setTimeout(() => setUpdateMsg(null), 5000)
    }
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY)
    setUser(null)
    setSelected(null)
    setQuery('')
  }

  if (!authChecked) return null

  if (!user) {
    return <LoginScreen onLogin={setUser} />
  }

  if (loading) {
    return (
      <div className="loading">
        <p>جاري تحميل لوحة المراقبة...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="empty">
        <h3>خطأ في التحميل</h3>
        <p>{error || 'بيانات غير متوفرة'}</p>
      </div>
    )
  }

  return (
    <>
      <header className="header">
        <div className="container header-inner">
          <img
            src="/logo-humanities.jpeg"
            alt="كلية الإنسانيات"
            className="header-logo"
          />
          <div className="header-text">
            <h1>لوحة المراقبة</h1>
            <p>امتحانات منتصف الترم · 2026</p>
          </div>
          <div className="header-user">
            <span className="user-name">{user.name}</span>
            <button type="button" className="btn-logout" onClick={logout}>
              خروج
            </button>
          </div>
        </div>
      </header>

      <main className="container">
        {updateMsg && <div className="update-banner">{updateMsg}</div>}

        <section className="search-section">
          <div className="search-box">
            <input
              type="search"
              placeholder="اكتب اسمك هنا..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelected(null)
              }}
              autoFocus
              autoComplete="off"
            />
          </div>
          <p className="search-hint">
            ابحث بالاسم أو جزء منه · {data.people.length} مراقب مسجّل
          </p>
        </section>

        {query.trim() && !selected && (
          <div className="results">
            {matches.length === 0 ? (
              <div className="empty">
                <h3>لا توجد نتائج</h3>
                <p>جرّب جزء من الاسم أو تأكد من الإملاء</p>
              </div>
            ) : (
              <>
                <p className="results-title">{matches.length} نتيجة</p>
                {matches.map((p) => (
                  <button
                    key={p.full}
                    className="person-btn"
                    onClick={() => setSelected(p)}
                  >
                    {p.full}
                    <span className="college-tag">
                      · {data.college_map[p.college] || p.college}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {selected && (
          <>
            <div className="person-card">
              <h2>{selected.full}</h2>
              <div className="person-meta">
                <span>
                  الكلية:{' '}
                  <strong>
                    {data.college_map[selected.college] || selected.college}
                  </strong>
                </span>
                <span>
                  كنترول كليتك:{' '}
                  <strong>{data.control_rooms[selected.college] || '—'}</strong>
                </span>
                <span>
                  عدد المراقبات: <strong>{schedule.length}</strong>
                </span>
              </div>
              {personConflicts.length > 0 && (
                <div className="conflict-badge">
                  ⚠ {personConflicts.length} تعارض في الجدول
                </div>
              )}
            </div>

            {groupByDay(schedule).map(([day, items]) => (
              <div key={day} className="day-block">
                <h3 className="day-header">{day}</h3>
                {items.map((a, i) => (
                  <div
                    key={`${a.hall}-${a.period}-${i}`}
                    className={`shift-card ${hasConflict(a) ? 'has-conflict' : ''}`}
                  >
                    <div className="shift-top">
                      <div>
                        <div className="period">
                          {a.is_responsible && (
                            <span className="resp-tag">مسؤول</span>
                          )}
                          الفترة {a.period}
                        </div>
                        <div className="time">{a.time}</div>
                      </div>
                      <div className="hall">{a.hall}</div>
                    </div>
                    <div className="exam-college">
                      <span
                        className="dot"
                        style={{
                          background:
                            COLLEGE_COLORS[a.exam_college] || '#999',
                        }}
                      />
                      لجنة{' '}
                      {data.college_map[a.exam_college] || a.exam_college}
                    </div>
                    <div className="control-room">
                      الكنترول:{' '}
                      <strong>
                        {data.control_rooms[a.exam_college] || '—'}
                      </strong>
                    </div>
                    {a.colleagues && a.colleagues.length > 0 && (
                      <div className="colleagues">
                        <strong>مع:</strong>{' '}
                        {a.colleagues
                          .filter((c) => typeof c === 'string' && c.trim())
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {schedule.length === 0 && (
              <div className="empty">
                <h3>لا توجد مراقبات</h3>
                <p>هذا الاسم غير مسجّل في أي لجنة حالياً</p>
              </div>
            )}
          </>
        )}

        {!query.trim() && !selected && (
          <div className="empty">
            <h3>ابدأ بالبحث</h3>
            <p>اكتب اسمك أو جزء منه عشان تشوف جدول المراقبات</p>
          </div>
        )}

        <div className="status-bar">
          <span>
            آخر تحديث: {data.fetched_at || 'محلي'} · {data.assignments.length}{' '}
            تكليف
          </span>
          <button
            className="btn-check"
            onClick={checkUpdates}
            disabled={checking}
          >
            {checking ? 'جاري التحقق...' : 'تحقق من التحديثات'}
          </button>
        </div>
      </main>
    </>
  )
}

export default App
