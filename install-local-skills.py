import hashlib
import json
import re
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent
DEST = ROOT / '.agents' / 'skills'
DOWNLOADS = Path.home() / 'Downloads'
SINGLES = {
    'jakkusakura-skills-frontend-design-1.0.1': 'frontend-design-jakkusakura',
    'alexh-adobe-fonts-skill-1.0.1': 'adobe-fonts-skill',
    'fcakyon-claude-codex-settings-web-design-guidelines-1.0.1': 'web-design-guidelines-fcakyon',
    'juliusbrussee-skills-fuck-slop': 'fuck-slop',
    'myclaude-skills-codex': 'codex-myclaude',
    'claude-code-frontend-design': 'frontend-design',
    'familybudget-frontend-development': 'familybudget-frontend-development',
    'agent-skills-react-best-practices': 'react-best-practices',
    '33-js-concepts-seo-review': 'seo-review',
    'ui-ux-pro-max-skill-ui-ux-pro-max': 'ui-ux-pro-max',
    'vercel-labs-skills-find-skills': 'find-skills',
    'vercel-labs-agent-skills-web-design-guidelines': 'web-design-guidelines',
}
OPEN_DESIGN = '''apple-hig artifacts-builder brand-extract brandkit brutalist-skill color-expert copywriting creative-director design-brief design-consultation design-md design-review emil-design-eng emilkowalski-motion frontend-dev frontend-skill gpt-tasteskill image-to-code-skill impeccable-design-polish minimalist-skill plan-design-review platform-design redesign-skill reference-design-contract review-animations shadcn-ui taste-skill theme-factory threejs ui-skills web-artifacts-builder web-clone wpds'''.split()
AWESOME = 'brand-guidelines canvas-design theme-factory webapp-testing'.split()

def main():
    install = '--install' in sys.argv
    selected = [(k + '.zip', '', v) for k, v in SINGLES.items()]
    selected += [('open-design-main.zip', 'open-design-main/skills/' + n + '/', 'open-design-' + n) for n in OPEN_DESIGN]
    selected += [('awesome-codex-skills-master.zip', 'awesome-codex-skills-master/' + n + '/', 'awesome-' + n) for n in AWESOME]
    records = []
    for archive, prefix, name in selected:
        payload = {}
        with zipfile.ZipFile(DOWNLOADS / archive) as z:
            for entry in z.infolist():
                if entry.is_dir() or not entry.filename.startswith(prefix):
                    continue
                relative = entry.filename[len(prefix):]
                path = PurePosixPath(relative)
                if path.is_absolute() or '..' in path.parts or '\\' in relative or ':' in relative:
                    raise ValueError('Unsafe archive path: ' + relative)
                if stat.S_ISLNK(entry.external_attr >> 16):
                    raise ValueError('Symlink in archive: ' + relative)
                payload[relative] = z.read(entry)
        skill = payload['SKILL.md'].decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
        if not skill.startswith('---') or not re.search(r'^description:', skill, re.M):
            raise ValueError('Invalid skill metadata: ' + name)
        original_name = re.search(r'^name:\s*(.+)$', skill, re.M).group(1).strip()
        skill = re.sub(r'^name:.*$', 'name: ' + name, skill, count=1, flags=re.M)
        payload['SKILL.md'] = skill.encode('utf-8')
        target = DEST / name
        if target.exists():
            raise FileExistsError('Refusing to overwrite: ' + str(target))
        records.append({'name': name, 'source': archive, 'source_path': prefix + 'SKILL.md', 'original_name': original_name, 'files': len(payload), 'sha256': {p: hashlib.sha256(b).hexdigest() for p, b in payload.items()}})
        if install:
            for relative, data in payload.items():
                output = target.joinpath(*PurePosixPath(relative).parts)
                if not output.resolve().is_relative_to(DEST.resolve()):
                    raise ValueError('Destination escaped')
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(data)
    report = {
        'scope': 'project', 'destination': str(DEST), 'installed': install,
        'skills': records,
        'excluded': {
            'awesome-agent-skills-main.zip': 'Catalogo de enlaces sin SKILL.md; no es una skill instalable.',
            'codex-main.zip': 'Codigo fuente de Codex; skills internas de desarrollo del repositorio y ejemplos de skills de sistema. No se instala el programa ni se reemplazan skills de sistema.',
            'awesome-codex-skills-master.zip': 'Seleccionadas 4 skills de diseno y pruebas web; excluidas automatizaciones de servicios y otras tareas ajenas al proyecto.',
            'open-design-main.zip': 'Seleccionadas 33 skills de diseno web; excluidos el programa, plantillas de video/documentos, fixtures y otras integraciones.'
        },
        'limitations': [
            'UI UX Pro Max: el ZIP solo contiene SKILL.md; faltan scripts/search.py y la base de datos. Instalada como guia, busqueda no operativa.',
            'React Best Practices: el ZIP no incluye references/react-performance-guidelines.md ni references/rules/. La guia resumida esta disponible.',
            'FamilyBudget: referencias y dependencias propias del repositorio original ausentes. Su uso requiere adaptacion al proyecto.',
            'Adobe Fonts: usar Node y scripts/afont.js en Windows; para API se requiere ADOBE_FONTS_API_TOKEN. No se configuraron credenciales.',
            'Las skills de colecciones pueden requerir herramientas, servicios o archivos externos propios de sus autores; instalacion no equivale a configurar esas integraciones.',
            'No se ejecutaron scripts, comandos ni instrucciones de los ZIP. Nombres normalizados y variantes renombradas para evitar colisiones.'
        ]
    }
    if install:
        (ROOT / 'skills-installation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        lines = ['# Skills para PWA Pollito Casero', '', 'Instalacion local en `.agents/skills`. Disponibles a partir del siguiente turno.', '', '## Instaladas', '']
        lines += ['- `' + r['name'] + '` — ' + r['source'] for r in records]
        lines += ['', '## Archivos y contenido excluidos', '']
        lines += ['- ' + k + ': ' + v for k, v in report['excluded'].items()]
        lines += ['', '## Limitaciones', ''] + ['- ' + n for n in report['limitations']]
        (ROOT / 'SKILLS-INSTALADAS.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps({'installed': install, 'count': len(records), 'files': sum(r['files'] for r in records), 'destination': str(DEST)}, ensure_ascii=True))

if __name__ == '__main__':
    main()
