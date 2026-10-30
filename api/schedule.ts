import type { VercelRequest, VercelResponse } from '@vercel/node'
import * as XLSX from 'xlsx'

const SHEET_ID = '1bO3d36jArqPEwmvqGtNkUfJByxpNw3ojl6SPdoELYaw'
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`

const COLLEGE_MAP: Record<string, string> = {
  CS: 'حاسبات', ART: 'فنون', V: 'بيطرى', MEDIA: 'اعلام',
  L: 'دراسات ادبية', LAW: 'قانون', H: 'انسانيات', NUR: 'تمريض'
}
const CONTROL_ROOMS: Record<string, string> = {
  CS: 'B517', ART: 'A513', V: 'A517', MEDIA: 'A516',
  L: 'B516', LAW: 'A514', H: 'A515', NUR: 'C513'
}
const DAY_MAP: Record<string, string> = {
  'السبت 3110': 'السبت 31/10', 'الاحد 111': 'الأحد 1/11',
  'الاثنين 211': 'الاثنين 2/11', 'الثلاثاء 311': 'الثلاثاء 3/11',
  'الاربعاء 411': 'الأربعاء 4/11', 'الخميس 511': 'الخميس 5/11',
  'السبت 711': 'السبت 7/11',
}
const PERIOD_MAP: Record<string, string> = {
  'فتره اولي': 'الأولى (09:00-10:00)', 'فتره تانيه': 'الثانية (11:00-12:00)',
  'فتره تالته': 'الثالثة (01:00-02:00)', 'فتره رابعه': 'الرابعة (03:00-04:00)',
}

function parseSheetName(name: string) {
  for (const [k, v] of Object.entries(DAY_MAP)) {
    if (name.includes(k)) {
      for (const [pk, pv] of Object.entries(PERIOD_MAP)) {
        if (name.includes(pk)) return { day: v, period: pv }
      }
    }
  }
  return { day: name, period: '' }
}

function extractProctors(cell: any) {
  if (!cell || typeof cell !== 'string') return []
  const results: any[] = []
  const parts = String(cell).split(/[\n\r]+/)
  for (let part of parts) {
    part = part.trim()
    if (!part || part === '1' || part === '1.0') continue
    part = part.replace(/^1[\s\.]*/, '').trim()
    if (!part) continue
    const isResp = /\s*م\s*$/.test(part)
    const clean = part.replace(/\s*م\s*$/, '').trim()
    const m = clean.match(/^(.+?)\s*\(([A-Za-z]+)\)\s*$/) || clean.match(/(.+?)\s*\(([A-Za-z]+)\)/)
    if (m) {
      const name = m[1].trim()
      const college = m[2].trim().toUpperCase()
      if (name && college && name !== '1') {
        results.push({ name, college, full: `${name} (${college})`, is_responsible: isResp })
      }
    }
  }
  return results
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const response = await fetch(EXPORT_URL, {
      headers: { 'User-Agent': 'ProctorBoard/1.0' },
    })
    if (!response.ok) throw new Error(`Google export failed: ${response.status}`)

    const buffer = await response.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })

    const assignments: any[] = []
    const peopleMap: Record<string, any> = {}

    for (const sheetName of wb.SheetNames) {
      if (sheetName === 'الوان الكليات') continue
      const { day, period } = parseSheetName(sheetName)
      const ws = wb.Sheets[sheetName]
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })

      for (const row of rows) {
        if (!row || !row[0] || !row[1]) continue
        const hall = String(row[0]).trim()
        const time = String(row[1])
        const examCollege = row[2] ? String(row[2]).trim() : ''
        if (!hall) continue

        const proctors: any[] = []
        for (let c = 3; c < Math.min(row.length, 8); c++) {
          proctors.push(...extractProctors(row[c]))
        }
        // unique
        const seen = new Set<string>()
        const unique = proctors.filter((p) => {
          if (seen.has(p.full)) return false
          seen.add(p.full)
          return true
        })

        for (const p of unique) {
          peopleMap[p.full] = { name: p.name, college: p.college }
          const colleagues = unique
            .filter((x) => x.full !== p.full)
            .map((x) => x.full + (x.is_responsible ? ' م' : ''))
          assignments.push({
            day, period, time, hall, exam_college: examCollege,
            name: p.name, college: p.college, full_name: p.full,
            is_responsible: p.is_responsible, colleagues,
          })
        }
      }
    }

    // conflicts
    const timePerson: Record<string, any[]> = {}
    for (const a of assignments) {
      const key = `${a.full_name}|${a.day}|${a.period}`
      if (!timePerson[key]) timePerson[key] = []
      timePerson[key].push(a)
    }
    const conflicts = []
    for (const [key, list] of Object.entries(timePerson)) {
      const halls = new Set(list.map((x) => x.hall))
      if (halls.size > 1) {
        const [person, day, period] = key.split('|')
        conflicts.push({ person, day, period, halls: Array.from(halls) })
      }
    }

    const people = Object.entries(peopleMap)
      .map(([full, v]) => ({ full, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'))

    const payload = {
      assignments,
      people,
      conflicts,
      college_map: COLLEGE_MAP,
      control_rooms: CONTROL_ROOMS,
      source: 'live_google_sheet',
      fetched_at: new Date().toISOString().slice(0, 16).replace('T', ' '),
    }

    // Cache for 5 minutes
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate')
    return res.status(200).json(payload)
  } catch (err: any) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Failed to fetch schedule' })
  }
}
