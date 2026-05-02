# English Label Reader AWS

เว็บอ่านข้อความภาษาอังกฤษจากฉลากสินค้า ป้าย กล่อง ขวด หรือเมนู โดยใช้กล้องมือถือ และใช้ AWS Rekognition DetectText เป็น OCR หลัก

## วิธีใช้งาน

1. กด Start Camera
2. ให้ข้อความภาษาอังกฤษอยู่ในกรอบ
3. กด Scan Text
4. รอ OCR จาก AWS Rekognition
5. ดูข้อความที่อ่านได้และฟังเสียงอ่าน

## ตั้งค่า AWS IAM Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowDetectTextOnly",
      "Effect": "Allow",
      "Action": "rekognition:DetectText",
      "Resource": "*"
    }
  ]
}
```

## Environment Variables บน Vercel

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
```

ตัวอย่าง region: `ap-southeast-1`

## Deploy

Push โปรเจกต์นี้ขึ้น GitHub แล้ว Import เข้า Vercel จากนั้นตั้ง Environment Variables และ Redeploy
