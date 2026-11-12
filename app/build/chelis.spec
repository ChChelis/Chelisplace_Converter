# PyInstaller: pasta (não arquivo único) com o servidor, a interface, os scripts do bot, o modelo e os modelos do OCR.
# Uso (na raiz do repositório): pyinstaller app/build/chelis.spec --noconfirm
import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT = os.path.abspath(os.path.join(SPECPATH, "..", ".."))  # o spec resolve caminhos a partir da própria pasta

datas = collect_data_files("rapidocr_onnxruntime") + [(os.path.join(ROOT, "app", "web"), "app/web"), (os.path.join(ROOT, "app", "modelo"), "app/modelo")]
hidden = collect_submodules("rapidocr_onnxruntime") + ["compare", "make_order", "calibrate", "deck_parse", "export_order", "build_review_artifact"]

a = Analysis([os.path.join(ROOT, "app", "server.py")], pathex=[os.path.join(ROOT, "scripts")], datas=datas, hiddenimports=hidden, excludes=["tkinter", "matplotlib", "scipy", "pandas"])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="BotChelisplace", console=True)  # console=True: a janela mostra o endereço e os erros
coll = COLLECT(exe, a.binaries, a.datas, name="BotChelisplace")
