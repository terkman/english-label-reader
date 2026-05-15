# English Label Reader — AR-like Auto OCR Level 3

เวอร์ชันนี้ทำให้เว็บอ่านฉลากใกล้เคียงการสแกน AR มากขึ้น

## สิ่งที่ทำ

- เปิดกล้องแล้วอ่านอัตโนมัติ
- ไม่ต้องกด Scan Text เป็นหลัก
- ตรวจว่ากล้องนิ่งก่อนส่ง OCR
- ใช้ AWS Rekognition DetectText อ่านข้อความ
- ใช้ bounding box จาก AWS เพื่อวางข้อความ 3D ใกล้ตำแหน่งข้อความจริง
- มี light tracking เพื่อขยับข้อความตามภาพระหว่างรอบ OCR
- ไม่อ่านเสียงซ้ำถ้าข้อความเดิม
- มีปุ่ม Pause / Speak / Scan Again

## Vercel Environment Variables

ตั้งค่าใน Vercel:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
```

แนะนำ:

```text
AWS_REGION=ap-southeast-1
```

หลังอัปไฟล์ขึ้น GitHub แล้วให้ไป Vercel → Deployments → Redeploy
