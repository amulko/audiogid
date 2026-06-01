import re, os, time
from gtts import gTTS

ROUTES = [
    {
        'file': '/root/veloprokat-audiogid/content_pedestrian_zgk.js',
        'prefix': 'pedestrian_zgk',
        'label': 'Пешая прогулка Зеленоградск'
    },
    {
        'file': '/root/veloprokat-audiogid/content_pedestrian_svt.js',
        'prefix': 'pedestrian_svt',
        'label': 'Пешая прогулка Светлогорск'
    },
]

os.makedirs('/root/veloprokat-audiogid/audio', exist_ok=True)

for route in ROUTES:
    print(f'\n=== {route["label"]} ===')
    with open(route['file'], 'r', encoding='utf-8') as f:
        content = f.read()

    texts = re.findall(r'audio:\s*`(.*?)`', content, re.DOTALL)
    names = re.findall(r'name:\s*"([^"]+)"', content)

    for i, (text, name) in enumerate(zip(texts, names), 1):
        text = text.strip()
        text = re.sub(r'\n+', '. ', text)
        text = re.sub(r'\s+', ' ', text)
        out = f'/root/veloprokat-audiogid/audio/{route["prefix"]}_wp{i}.mp3'
        print(f'  [{i}/{len(texts)}] {name} ...', flush=True)
        tts = gTTS(text=text, lang='ru', slow=False)
        tts.save(out)
        size = os.path.getsize(out) // 1024
        print(f'         ✓ {route["prefix"]}_wp{i}.mp3  {size} KB', flush=True)
        time.sleep(1)

print('\nГотово!')
