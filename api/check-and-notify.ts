import type { VercelRequest, VercelResponse } from '@vercel/node'
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'

const SHEET_ID = '1bO3d36jArqPEwmvqGtNkUfJByxpNw3ojl6SPdoELYaw'
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`

function simpleHash(str: string): string {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(16)
}

async function fetchFingerprint(): Promise<{ count: number; fingerprint: string }> {
  const response = await fetch(EXPORT_URL, {
    headers: { 'User-Agent': 'ProctorBoard-Notify/1.0' },
  })
  if (!response.ok) throw new Error(`Sheet export failed: ${response.status}`)
  const buffer = await response.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })

  const tokens: string[] = []
  let count = 0

  for (const sheetName of wb.SheetNames) {
    if (sheetName === 'الوان الكليات') continue
    const ws = wb.Sheets[sheetName]
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
    for (const row of rows) {
      if (!row?.[0] || !row?.[1]) continue
      for (let c = 3; c < Math.min(row.length, 8); c++) {
        const cell = row[c]
        if (cell && typeof cell === 'string' && cell.includes('(')) {
          tokens.push(`${sheetName}|${row[0]}|${cell}`)
          count++
        }
      }
    }
  }

  tokens.sort()
  return { count, fingerprint: simpleHash(tokens.join('||')) }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Protect: only Cron or manual with secret
  const secret = process.env.CRON_SECRET || ''
  const auth = req.headers.authorization || ''
  const isCron = req.headers['x-vercel-cron'] === '1'
  const hasSecret = secret && auth === `Bearer ${secret}`

  if (!isCron && !hasSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  const resendKey = process.env.RESEND_API_KEY || ''
  const fromEmail = process.env.NOTIFY_FROM_EMAIL || 'onboarding@resend.dev'
  const appUrl = process.env.APP_URL || 'https://your-app.vercel.app'

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase not configured' })
  }

  try {
    const { count, fingerprint } = await fetchFingerprint()
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Get last known fingerprint
    const { data: meta } = await supabase
      .from('schedule_meta')
      .select('*')
      .eq('id', 1)
      .maybeSingle()

    const prev = meta?.fingerprint as string | undefined
    const changed = !prev || prev !== fingerprint

    // Upsert current meta
    await supabase.from('schedule_meta').upsert({
      id: 1,
      fingerprint,
      assignment_count: count,
      updated_at: new Date().toISOString(),
    })

    if (!changed) {
      return res.status(200).json({
        ok: true,
        changed: false,
        count,
        message: 'No changes detected',
      })
    }

    // Send emails if Resend is configured
    let emailed = 0
    let emailError: string | null = null

    if (resendKey) {
      const { data: proctors, error: pErr } = await supabase
        .from('proctors')
        .select('name, email')

      if (pErr) {
        emailError = pErr.message
      } else if (proctors && proctors.length > 0) {
        // Send in batches of 50 (Resend limit friendliness)
        for (let i = 0; i < proctors.length; i += 50) {
          const batch = proctors.slice(i, i + 50)
          const payload = {
            from: fromEmail,
            to: batch.map((p: any) => p.email),
            subject: 'تحديث في جدول المراقبات — كلية الإنسانيات',
            html: `
              <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; line-height: 1.6;">
                <h2>تم تحديث جدول المراقبات</h2>
                <p>هناك تحديث جديد على جدول مراقبات امتحانات منتصف الترم.</p>
                <p>عدد التكليفات الحالي: <strong>${count}</strong></p>
                <p><a href="${appUrl}" style="display:inline-block;padding:10px 18px;background:#C45C26;color:#fff;text-decoration:none;border-radius:4px;">افتح لوحة المراقبة</a></p>
                <p style="color:#666;font-size:13px;">هذه رسالة تلقائية من نظام لوحة المراقبة.</p>
              </div>
            `,
          }

          // Resend batch: one email per recipient is more reliable on free tier
          for (const p of batch) {
            const r = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: fromEmail,
                to: p.email,
                subject: 'تحديث في جدول المراقبات — كلية الإنسانيات',
                html: `
                  <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; line-height: 1.6;">
                    <h2>مرحباً ${p.name || ''}</h2>
                    <p>تم تحديث جدول المراقبات.</p>
                    <p>عدد التكليفات الحالي: <strong>${count}</strong></p>
                    <p><a href="${appUrl}">افتح لوحة المراقبة</a></p>
                  </div>
                `,
              }),
            })
            if (r.ok) emailed++
            else {
              const t = await r.text()
              emailError = t.slice(0, 200)
            }
          }
        }
      }
    } else {
      emailError = 'RESEND_API_KEY not set — emails skipped'
    }

    return res.status(200).json({
      ok: true,
      changed: true,
      count,
      fingerprint,
      emailed,
      emailError,
      message: 'Schedule changed and notifications processed',
    })
  } catch (err: any) {
    console.error(err)
    return res.status(500).json({ error: err.message || 'Failed' })
  }
}
