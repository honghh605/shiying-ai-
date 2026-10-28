"""任务内 Key 调度：均匀分配，限流退避，失效 Key 暂停使用。"""
from __future__ import annotations

import threading
import time


class ScreeningKeyPool:
    def __init__(self, keys: list[str]):
        self.keys = list(dict.fromkeys(keys))
        self._busy = [0] * len(self.keys)
        self._ready = [0.0] * len(self.keys)
        self._disabled: set[int] = set()
        self._cursor = 0
        self._condition = threading.Condition()

    def acquire(self) -> tuple[int, str]:
        with self._condition:
            while True:
                usable = [i for i in range(len(self.keys)) if i not in self._disabled]
                if not usable:
                    raise ValueError("筛图 Key 均不可用，请检查权限或余额后重试")
                now = time.monotonic()
                ready = [i for i in usable if self._ready[i] <= now and self._busy[i] < 3]
                if ready:
                    i = min(ready, key=lambda i: (self._busy[i], (i - self._cursor) % len(self.keys)))
                    self._cursor = (i + 1) % len(self.keys)
                    self._busy[i] += 1
                    return i, self.keys[i]
                self._condition.wait(timeout=0.5)

    def release(self, index: int, status_code: int | None = None) -> None:
        with self._condition:
            self._busy[index] -= 1
            if status_code in (401, 403):
                self._disabled.add(index)
            elif status_code == 429:
                self._ready[index] = time.monotonic() + 15
            self._condition.notify_all()

    def redact(self, message: str) -> str:
        for key in self.keys:
            message = message.replace(key, "[API Key]")
        return message
