# لوحة المراقبة — كلية الإنسانيات · Midterm 2026

## المميزات
- تسجيل دخول (اسم + إيميل) → يتحفظ في Supabase
- بحث في جدول المراقبات + غرف الكنترول + التعارضات
- سحب لايف من جوجل شيت
- **إشعار إيميل تلقائي** كل ساعة لو حصل تحديث في الجدول

## الإعداد (مرة واحدة)

### 1) Supabase
1. أنشئ مشروع على supabase.com
2. SQL Editor → نفّذ `supabase-setup.sql`
3. انسخ Project URL + `anon` key + **service_role** key

### 2) Resend (للإيميلات — مجاني)
1. سجّل على [resend.com](https://resend.com)
2. أنشئ API Key
3. للتجربة: استخدم `onboarding@resend.dev` كـ From
4. للإنتاج: أضف دومينك ووثّقه

### 3) متغيرات البيئة
**محليًا** → ملف `.env.local` (انظر `.env.example`)

**على Vercel** → Settings → Environment Variables:
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
NOTIFY_FROM_EMAIL
APP_URL
CRON_SECRET
```

### 4) الرفع
```bash
npm install
npm run build
```
ارفع على GitHub → Vercel.  
الـ Cron شغال تلقائي كل ساعة (`0 * * * *`).

### تجربة الإشعار يدويًا
```bash
curl -X GET "https://YOUR-APP.vercel.app/api/check-and-notify" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## ملاحظات
- أول تشغيل للـ Cron بيسجّل البصمة الحالية ومش بيبعت إيميل (مفيش "تغيير" بعد).
- من تاني تحديث في جوجل شيت → هيبدأ يبعت.
- مجاني Resend: حوالي 100 إيميل/يوم و 3000/شهر.
