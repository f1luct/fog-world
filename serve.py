# 开发服务器:禁缓存,改完代码刷新就是最新的。
# 用法: python serve.py [端口,默认 8077]
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8077
http.server.ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
