# -*- coding: utf-8 -*-
"""把 ECDICT 完整词典精简为应用内置词典。

保留条件（满足其一）：
  1. tag 含考试标签: cet4 cet6 ky(考研) toefl ielts gre
  2. COCA 词频 frq <= 60000
  3. BNC 词频 bnc <= 60000
输出: resources/dict-mini.tsv（tab 分隔: word, phonetic, pos, translation, definition, tag）
"""
import csv
import os
import sys

SRC = os.path.join(os.path.dirname(__file__), '..', 'ecdict_full.csv')
DST_DIR = os.path.join(os.path.dirname(__file__), '..', 'resources')
DST = os.path.join(DST_DIR, 'dict-mini.tsv')

EXAM_TAGS = {'cet4', 'cet6', 'ky', 'toefl', 'ielts', 'gre'}
FREQ_KEEP = 60000

os.makedirs(DST_DIR, exist_ok=True)

kept = 0
seen = set()
with open(SRC, 'r', encoding='utf-8', errors='replace') as f, \
     open(DST, 'w', encoding='utf-8', newline='') as out:
    reader = csv.DictReader(f)
    for row in reader:
        word = (row.get('word') or '').strip()
        if not word or not word.isascii():
            continue
        # 跳过短语中带下划线/空格的可保留（很多常用短语），但跳过含非法字符的
        if any(c in word for c in '/\\<>'):
            continue
        wl = word.lower()
        if wl in seen:
            continue

        tag = (row.get('tag') or '').strip()
        tags = set(tag.split())
        try:
            frq = int(row.get('frq') or 0)
        except ValueError:
            frq = 0
        try:
            bnc = int(row.get('bnc') or 0)
        except ValueError:
            bnc = 0

        if not (tags & EXAM_TAGS or 0 < frq <= FREQ_KEEP or 0 < bnc <= FREQ_KEEP):
            continue

        phonetic = (row.get('phonetic') or '').strip().replace('\t', ' ')
        pos = (row.get('pos') or '').strip().replace('\t', ' ')
        translation = (row.get('translation') or '').strip()
        definition = (row.get('definition') or '').strip()
        # 清洗：真实换行 + 字面量 \n（ECDICT 用反斜杠n分隔义项）统一为 " | "，去 tab
        translation = translation.replace('\r\n', ' | ').replace('\r', ' ').replace('\n', ' | ')
        translation = translation.replace('\\n', ' | ').replace('\\r', ' ')
        translation = translation.replace('\t', ' ')
        definition = definition.replace('\r\n', ' | ').replace('\r', ' ').replace('\n', ' | ')
        definition = definition.replace('\\n', ' | ').replace('\\r', ' ')
        definition = definition.replace('\t', ' ')
        # 截断过长内容
        if len(translation) > 300:
            translation = translation[:300] + '…'
        if len(definition) > 400:
            definition = definition[:400] + '…'

        out.write('\t'.join([word, phonetic, pos, translation, definition, ' '.join(sorted(tags & EXAM_TAGS))]) + '\n')
        seen.add(wl)
        kept += 1

size_mb = os.path.getsize(DST) / 1024 / 1024
print(f'OK: 保留 {kept} 词条, 输出 {size_mb:.1f}MB -> {DST}')
