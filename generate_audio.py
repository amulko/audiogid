import re, os, time
from gtts import gTTS

with open('/root/veloprokat-audiogid/content.js', 'r', encoding='utf-8') as f:
    content = f.read()

matches = re.findall(r'audio:\s*`(.*?)`', content, re.DOTALL)
names   = re.findall(r'name:\s*"([^"]+)"', content)

os.makedirs('/root/veloprokat-audiogid/audio', exist_ok=True)

for i, (text, name) in enumerate(zip(matches, names), 1):
    text = text.strip()
    text = re.sub(r'\n+', '. ', text)
    text = re.sub(r'\s+', ' ', text)
    out  = f'/root/veloprokat-audiogid/audio/wp{i}.mp3'
    print(f'[{i}/11] {name} ...', flush=True)
    tts = gTTS(text=text, lang='ru', slow=False)
    tts.save(out)
    size = os.path.getsize(out) // 1024
    print(f'       ✓ wp{i}.mp3  {size} KB', flush=True)
    time.sleep(1)  # не спамить Google

print('\nГотово!')
