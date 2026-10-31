@echo off
REM ═══ GoldPro — تشغيل التطبيق في وضع الكشك (Kiosk) على ويندوز ═══
REM يفتح Google Chrome بملء الشاشة بالكامل بلا أشرطة. للخروج: Alt+F4
REM إن كان رابط تطبيقك مختلفاً، غيّر العنوان في السطر التالي:
set URL=https://balali76-web.github.io/
start chrome --kiosk --app=%URL%
