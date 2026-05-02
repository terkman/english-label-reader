# English Label Reader AWS

เว็บอ่านข้อความภาษาอังกฤษจากฉลากสินค้า ป้าย กล่อง ขวด หรือเมนู โดยใช้กล้องมือถือ และใช้ AWS Rekognition DetectText เป็น OCR หลัก

## วิธีใช้

1. เปิดเว็บบนมือถือ
2. กด Start Camera
3. เล็งข้อความให้อยู่ในกรอบ
4. กด Scan Text
5. รอระบบอ่านข้อความ
6. กด Speak เพื่อฟังซ้ำ
7. กด Scan Again เพื่อสแกนใหม่

## Environment Variables สำหรับ Vercel

ตั้งค่าใน Vercel Project → Settings → Environment Variables

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
```

แนะนำ region:

```text
ap-southeast-1
```

## หมายเหตุ

GitHub Pages ใช้ทดสอบหน้าเว็บและกล้องได้ แต่ OCR ต้องใช้ผ่าน Vercel เพราะต้องรันไฟล์ `api/ocr.js`
