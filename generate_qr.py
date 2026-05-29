#!/usr/bin/env python3
"""
Генератор ежедневного QR-кода для ВелоПРОбег АудиоГид.

Запуск:  python3 generate_qr.py
         python3 generate_qr.py --email      # отправить на почту
         python3 generate_qr.py --tomorrow   # сгенерировать на завтра

Настройте BASE_URL и EMAIL_* перед использованием.
"""

import hmac
import hashlib
import argparse
import os
import smtplib
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage

import qrcode
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers import RoundedModuleDrawer

# ─── НАСТРОЙКИ ───────────────────────────────────────────────────────────────

# URL вашего приложения (должен быть стабильным, а не временным Cloudflare-тоннелем)
# Пример: https://veloprokat-guide.pages.dev  или  https://ваш-домен.ru
BASE_URL = 'https://amulko.github.io/audiogid'

# Секретный ключ — должен совпадать с SECRET в index.html
SECRET = 'vbp8kzm2025xQ'

# Email-настройки (Gmail)
EMAIL_FROM    = 'veloprobeg39@yandex.ru'  # Яндекс-почта
EMAIL_TO      = 'amulko@mail.ru'          # куда слать QR
EMAIL_PASS    = 'xailiyrpixmeidkq'        # пароль приложения Яндекс

# ─────────────────────────────────────────────────────────────────────────────

MSK = timezone(timedelta(hours=3))


def compute_token(date_str: str) -> str:
    """Вычисляет токен для заданной даты (YYYY-MM-DD)."""
    sig = hmac.new(SECRET.encode(), date_str.encode(), hashlib.sha256).hexdigest()
    return sig[:10]


def generate_qr(date_str: str, token: str) -> str:
    """Генерирует QR-код и возвращает путь к файлу."""
    url = f"{BASE_URL}/?k={token}"

    qr = qrcode.QRCode(
        version=2,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=12,
        border=3,
    )
    qr.add_data(url)
    qr.make(fit=True)

    try:
        img = qr.make_image(
            image_factory=StyledPilImage,
            module_drawer=RoundedModuleDrawer(),
            fill_color='#2876C8',
            back_color='white',
        )
    except Exception:
        img = qr.make_image(fill_color='#2876C8', back_color='white')

    path = f'/tmp/velogid_qr_{date_str}.png'
    img.save(path)
    return path, url


def send_email(date_str: str, qr_path: str, url: str) -> None:
    """Отправляет QR-код на почту."""
    msg = MIMEMultipart('related')
    msg['Subject'] = f'ВелоПРОбег · QR-код на {date_str}'
    msg['From'] = EMAIL_FROM
    msg['To'] = EMAIL_TO

    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;text-align:center">
      <h2 style="color:#2876C8">🚲 ВелоПРОбег · АудиоГид</h2>
      <p style="color:#555">QR-код на <strong>{date_str}</strong><br>
      Действует до полуночи по московскому времени</p>
      <img src="cid:qrcode" style="width:280px;height:280px;border:1px solid #eee;border-radius:12px"><br>
      <p style="font-size:12px;color:#999;margin-top:8px">Ссылка: <a href="{url}">{url}</a></p>
    </div>
    """
    msg.attach(MIMEText(html, 'html'))

    with open(qr_path, 'rb') as f:
        img = MIMEImage(f.read())
        img.add_header('Content-ID', '<qrcode>')
        msg.attach(img)

    with smtplib.SMTP_SSL('smtp.yandex.ru', 465) as s:
        s.login(EMAIL_FROM, EMAIL_PASS)
        s.send_message(msg)
    print(f'  ✉️  Письмо отправлено на {EMAIL_TO}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--email',    action='store_true', help='Отправить по почте')
    parser.add_argument('--tomorrow', action='store_true', help='Сгенерировать на завтра')
    args = parser.parse_args()

    now = datetime.now(MSK)
    if args.tomorrow:
        now += timedelta(days=1)

    date_str = now.strftime('%Y-%m-%d')
    token    = compute_token(date_str)
    qr_path, url = generate_qr(date_str, token)

    print(f'\n  Дата:   {date_str}')
    print(f'  Токен:  {token}')
    print(f'  Ссылка: {url}')
    print(f'  QR:     {qr_path}\n')

    if args.email:
        if EMAIL_FROM == 'your-email@gmail.com':
            print('  ⚠️  Укажите EMAIL_FROM и EMAIL_PASS в начале скрипта')
        else:
            send_email(date_str, qr_path, url)


if __name__ == '__main__':
    main()
