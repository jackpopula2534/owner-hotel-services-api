#!/bin/bash
# เช็คสถานะ services ที่ backend ต้องใช้
echo "=========================================="
echo "  StaySync — เช็คสถานะ services"
echo "=========================================="
echo ""

echo "--- 1) Port 9012 (MySQL) ---"
if lsof -nP -iTCP:9012 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ มี process ฟัง port 9012"
  lsof -nP -iTCP:9012 -sTCP:LISTEN | head -5
else
  echo "❌ ไม่มี process ฟัง port 9012 (MySQL ไม่รัน)"
fi
echo ""

echo "--- 2) Port 6379 (Redis) ---"
if lsof -nP -iTCP:6379 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ มี process ฟัง port 6379"
  lsof -nP -iTCP:6379 -sTCP:LISTEN | head -5
else
  echo "❌ ไม่มี process ฟัง port 6379 (Redis ไม่รัน)"
fi
echo ""

echo "--- 3) Port 9011 (Backend API) ---"
if lsof -nP -iTCP:9011 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ Backend รันอยู่แล้ว"
  lsof -nP -iTCP:9011 -sTCP:LISTEN | head -5
else
  echo "❌ Backend ยังไม่รัน"
fi
echo ""

echo "--- 4) Port 9010 (Frontend) ---"
if lsof -nP -iTCP:9010 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ Frontend รันอยู่"
else
  echo "❌ Frontend ไม่รัน"
fi
echo ""

echo "--- 5) Docker containers ---"
if command -v docker >/dev/null 2>&1; then
  if docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | grep -E "hotel|mysql|redis" ; then
    :
  else
    echo "(ไม่พบ container hotel-*)"
  fi
else
  echo "(ไม่มี docker)"
fi
echo ""

echo "--- 6) MAMP MySQL? ---"
if pgrep -fl mysqld | head -3 ; then
  :
else
  echo "(ไม่พบ mysqld process)"
fi
echo ""

echo "=========================================="
echo "  เสร็จแล้ว — copy ผลทั้งหมดส่งให้บ่าวค่ะ"
echo "=========================================="
