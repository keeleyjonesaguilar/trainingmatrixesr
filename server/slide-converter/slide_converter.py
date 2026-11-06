# ESR slide converter - turns a PowerPoint into a PDF (one page per slide, hidden ones included) for
# the Content page's slide pictures (Training Matrix migration 093, 2026-11-06).
#
# Runs on Render as the private service "esr-slide-pictures": the gotenberg/gotenberg:8.37.0 image
# (for its LibreOffice and fonts), with this file as a Secret File and the Docker Command
#     tini -- python3 /etc/secrets/slide_converter.py
# Gotenberg itself isn't used - wrapped by it, LibreOffice needed over 512 MB and the $7 instance
# was killed; run directly it converts with about 230 MB.
#
#   GET  /health   -> "ok"
#   POST /convert  body = the .pptx bytes -> application/pdf
# One conversion at a time; each gets 5 minutes.
import os
import shutil
import signal
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('PORT', '10000'))
MAX_BYTES = 320 * 1024 * 1024
TIMEOUT_SECONDS = 300
PROFILE = '/tmp/lo-profile'
FILTER = ('pdf:impress_pdf_Export:{'
          '"ExportHiddenSlides":{"type":"boolean","value":"true"},'
          '"Quality":{"type":"long","value":"75"},'
          '"ReduceImageResolution":{"type":"boolean","value":"true"},'
          '"MaxImageResolution":{"type":"long","value":"150"}}')
one_at_a_time = threading.Lock()


def convert(pptx_path, out_dir):
    proc = subprocess.Popen(
        ['soffice', f'-env:UserInstallation=file://{PROFILE}', '--headless', '--norestore',
         '--nolockcheck', '--convert-to', FILTER, '--outdir', out_dir, pptx_path],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        output, _ = proc.communicate(timeout=TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.communicate()
        raise RuntimeError('took longer than 5 minutes')
    pdf = os.path.join(out_dir, 'deck.pdf')
    if not os.path.exists(pdf):
        # A broken profile can stop every later conversion - start the next one fresh.
        shutil.rmtree(PROFILE, ignore_errors=True)
        raise RuntimeError('LibreOffice made no PDF: ' + output.decode('utf-8', 'replace')[-300:])
    return pdf


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body, content_type='text/plain; charset=utf-8'):
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            return self.reply(200, b'ok')
        return self.reply(404, b'not found')

    def do_HEAD(self):  # Render's port check
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path != '/convert':
            return self.reply(404, b'not found')
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > MAX_BYTES:
            return self.reply(413, b'send the .pptx as the request body (up to 320 MB)')
        work = tempfile.mkdtemp(prefix='convert-')
        try:
            pptx = os.path.join(work, 'deck.pptx')
            with open(pptx, 'wb') as f:
                left = length
                while left > 0:
                    chunk = self.rfile.read(min(1024 * 1024, left))
                    if not chunk:
                        raise RuntimeError('upload cut short')
                    f.write(chunk)
                    left -= len(chunk)
            with one_at_a_time:
                pdf = convert(pptx, work)
            with open(pdf, 'rb') as f:
                body = f.read()
            return self.reply(200, body, 'application/pdf')
        except Exception as err:  # noqa: BLE001 - every failure goes back to the app as a message
            return self.reply(500, str(err).encode('utf-8', 'replace'))
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def log_message(self, fmt, *args):
        print('%s %s' % (self.address_string(), fmt % args), flush=True)


if __name__ == '__main__':
    print(f'ESR slide converter listening on {PORT}', flush=True)
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
