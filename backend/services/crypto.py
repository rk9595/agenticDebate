import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _get_key() -> bytes:
    key_b64 = os.environ.get("ENCRYPTION_KEY")
    if not key_b64:
        raise RuntimeError("ENCRYPTION_KEY env var not set")
    return base64.b64decode(key_b64)


def encrypt(plaintext: str) -> str:
    key = _get_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def decrypt(ciphertext: str) -> str:
    key = _get_key()
    aesgcm = AESGCM(key)
    data = base64.b64decode(ciphertext)
    nonce, ct = data[:12], data[12:]
    return aesgcm.decrypt(nonce, ct, None).decode()
