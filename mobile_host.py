import http.server
import socketserver
import socket
import os

PORT = 8000

def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # doesn't even have to be reachable
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

Handler = http.server.SimpleHTTPRequestHandler

# Change to the directory of the script if needed, or assume active directory
# os.chdir(os.path.dirname(os.path.abspath(__file__)))

with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    local_ip = get_ip()
    print(f"\n==================================================================")
    print(f"  MOBILE TESTING SERVER RUNNING")
    print(f"  On your mobile device, verify you are on the same Wi-Fi")
    print(f"  Then open: http://{local_ip}:{PORT}")
    print(f"\n  (Press Ctrl+C to stop)")
    print(f"==================================================================\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.shutdown()
