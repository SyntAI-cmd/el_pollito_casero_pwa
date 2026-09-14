"""Parsea las listas de precios (PDF de mañana y tarde, vía pdftotext) y las cruza con la planilla GC.
Uso: python scripts/parsear-listas.py import/   (espera import/lista-manana.pdf, import/lista-tarde.pdf, import/clientes.xlsx)
Genera import/precios.json para scripts/importar-gc.mjs. Requiere python3 + openpyxl + pdftotext (poppler)."""
import re, json, subprocess, unicodedata, openpyxl

import sys
CTX = (sys.argv[1] if len(sys.argv) > 1 else "import/") 
PRODUCTS = {
    "pollo": "entero", "cuarto": "cuarto-trasero", "alas": "alas", "ala": "alas",
    "suprema": "suprema", "pechuga": "pechuga", "muslo": "muslo", "menudo": "menudos",
    "menudos": "menudos", "garra": "garras", "garras": "garras", "rancho": "rancho",
}

FIXES = [("av�cola", "avícola"), ("andr�s", "andrés"), ("jos�", "josé"), ("agust�n", "agustín"),
         ("mat�as", "matías"), ("hern�n", "hernán"), ("n�stor", "néstor"), ("rub�n", "rubén"),
         ("porte�as", "porteñas"), ("mar�a", "maría"), ("an�bal", "aníbal"), ("luj�n", "luján"),
         ("jun�n", "junín"), ("gui�azu", "guiñazú"), ("tap�n", "tapón"), ("ag�ero", "agüero")]

def fix(t):
    out = t or ""
    for bad, good in FIXES:
        out = re.sub(bad, lambda m: good.capitalize() if m.group(0)[0].isupper() else good, out, flags=re.I)
    return out.replace("�", "")

def norm(s):
    s = unicodedata.normalize("NFD", fix(s)).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()

def parse(path, shift):
    txt = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True).stdout.decode("utf8", "replace")
    zone, client, out, pending = None, None, [], []
    item_re = re.compile(r"([A-Za-z\u00f1\u00d1\u00e1\u00e9\u00ed\u00f3\u00fa]+(?: sin menudo)?)\s*\$\s*([\d.]*)")
    for raw in txt.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.startswith("LISTA DE PRECIOS"):
            continue
        # texto a la izquierda (nombre o zona) y items a la derecha
        items = item_re.findall(line)
        left = item_re.sub("", line).strip()
        left_is_zone = bool(left) and left == left.upper() and len(left) > 3 and not re.search(r"\d", left)
        if left_is_zone:
            zone = fix(left).title()
            pending = []  # los items en la línea de la zona son del próximo cliente
            for name, price in items:
                pending.append((name, price))
            client = None
            continue
        if left and not raw.startswith(" "):
            client = {"shift": shift, "zone": zone, "name": fix(left), "prices": {}, "raw": []}
            out.append(client)
            for name, price in pending:
                _add(client, name, price)
            pending = []
        elif left and raw.startswith(" ") and client is None:
            # nombre con sangría (columna derecha del PDF)
            client = {"shift": shift, "zone": zone, "name": fix(left), "prices": {}, "raw": []}
            out.append(client)
        elif left and raw.startswith(" ") and client is not None and not items:
            client = {"shift": shift, "zone": zone, "name": fix(left), "prices": {}, "raw": []}
            out.append(client)
        elif left and raw.startswith(" ") and client is not None and items:
            client = {"shift": shift, "zone": zone, "name": fix(left), "prices": {}, "raw": []}
            out.append(client)
        if client is None:
            for name, price in items:
                pending.append((name, price))
            continue
        for name, price in items:
            _add(client, name, price)
    return out

def _add(client, name, price):
    key = norm(name).split(" ")[0]
    pid = PRODUCTS.get(key)
    client["raw"].append(f"{name} ${price}")
    if pid and price:
        p = float(price.replace(".", "")) if price.count(".") == 1 and len(price.split(".")[1]) == 3 else float(price.replace(".", ""))
        client["prices"][pid] = p

lists = parse(CTX + "lista-manana.pdf", "manana") + parse(CTX + "lista-tarde.pdf", "tarde")

# cruce con GC
wb = openpyxl.load_workbook(CTX + "clientes.xlsx", data_only=True)
gc = []
for r in list(wb.active.iter_rows(min_row=2, values_only=True)):
    gc.append({"id": r[0], "cuit": r[1], "razon": " ".join(x for x in [r[2], r[3]] if x).strip(), "alias": (r[4] or "").strip(),
               "phone": str(r[5] or "").strip(), "address": r[8], "district": r[9], "cp": r[10]})

def score(name, c):
    n = norm(name); a = norm(c["alias"]); rz = norm(c["razon"])
    if not n: return 0
    if a == n: return 100
    if a and a.startswith(n + " "): return 90
    if a and n in a.split(" "): return 70
    if a and a.split(" ")[0] == n.split(" ")[0]: return 60
    if rz and n.split(" ")[0] in rz.split(" "): return 40
    return 0

def zone_ok(zone, c):
    z = norm(zone or "").split(" ")[0]
    if not z: return False
    d = norm(c.get("district") or "") + " " + norm(c["alias"])
    aliases = {"barriales": "los barriales", "california": "nueva californi", "beltran": "fray luis beltran", "junin": "junin", "catitas": "las catitas", "corralito": "los corralitos"}
    return z in d or aliases.get(z, "~~") in d

matched, unmatched = 0, []
for c in lists:
    best = max(gc, key=lambda g: score(c["name"], g))
    s = score(c["name"], best)
    # desempate por zona
    if s and s < 90:
        cands = [g for g in gc if score(c["name"], g) == s]
        if len(cands) > 1 and c["zone"]:
            z = norm(c["zone"])
            zc = [g for g in cands if z.split(" ")[0] in norm(g.get("district") or "") or z.split(" ")[0] in norm(g["alias"])]
            if len(zc) == 1: best = zc[0]
            elif len(cands) > 1: s = 0
    # nombre de pila + misma zona alcanza (GC a veces guarda la zona en "descripcion")
    if s < 60:
        cands = [g for g in gc if score(c["name"], g) >= 40 and zone_ok(c["zone"], g)]
        if len(cands) == 1:
            best, s = cands[0], 65
    c["gcId"] = best["id"] if s >= 60 else None
    c["gcAlias"] = best["alias"] if s >= 60 else None
    c["score"] = s
    if c["gcId"]: matched += 1
    else: unmatched.append(c["name"] + " (" + str(c["zone"]) + ")")

json.dump({"lists": lists, "gc": gc}, open(CTX + "precios.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
print("clientes en listas:", len(lists), "con precio:", sum(1 for c in lists if c["prices"]), "matcheados:", matched)
print("sin match:", unmatched)
for c in lists:
    print(f'{c["shift"]:6} {str(c["zone"]):16} {c["name"]:24} -> {c["gcAlias"]!s:26} {c["prices"]}')
