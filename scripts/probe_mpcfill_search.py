import json, sys, urllib.request
B = "https://mpcfill.com"
H = {"User-Agent": "chelisplace-probe/0.1", "Content-Type": "application/json"}
def post(path, body):
    r = urllib.request.Request(B + path, json.dumps(body).encode(), H)
    try:
        return json.load(urllib.request.urlopen(r, timeout=30))
    except urllib.error.HTTPError as e:
        sys.exit(e.read().decode()[:1500])
src = json.load(urllib.request.urlopen(urllib.request.Request(B + "/2/sources/", headers=H), timeout=30))["results"]
settings = {
    "filterSettings": {"excludesTags": [], "includesTags": [], "languages": [], "maximumDPI": 1500, "maximumSize": 30, "minimumDPI": 0},
    "searchTypeSettings": {"filterCardbacks": False, "fuzzySearch": False},
    "sourceSettings": {"sources": [[int(k), True] for k in src]},
}
name, exp, num = sys.argv[1], sys.argv[2], sys.argv[3]
res = post("/2/editorSearch/", {"queries": [{"query": name, "cardType": "CARD"}], "searchSettings": settings})["results"]
ids = res[name]["CARD"]
print(len(ids), "hits")
cards = post("/2/cards/", {"cardIdentifiers": ids[:8]})["results"]
for c in cards.values():
    print(json.dumps({k: c.get(k) for k in ("name", "sourceName", "dpi", "extension", "mediumThumbnailUrl", "canonicalCard")}, ensure_ascii=False)[:420])
