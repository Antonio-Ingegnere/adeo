"""A priority queue; smaller priorities run first, with FIFO ties."""
import heapq


class TaskQueue:
    def __init__(self):
        self._pending = []

    def add(self, task, priority=0):
        heapq.heappush(self._pending, (priority, len(self._pending), task))

    def pop(self):
        return heapq.heappop(self._pending)[2]

    def __len__(self):
        return len(self._pending)
