"""Independent acceptance oracle: preserve this file unchanged."""
import unittest
from task_queue import TaskQueue


class TaskQueueTests(unittest.TestCase):
    def test_priority_ordering(self):
        queue = TaskQueue()
        queue.add('low', 5)
        queue.add('urgent', -1)
        queue.add('normal', 0)
        self.assertEqual([queue.pop() for _ in range(3)], ['urgent', 'normal', 'low'])

    def test_equal_priority_fifo(self):
        queue = TaskQueue()
        for task in ('z-first', 'm-second', 'a-third'):
            queue.add(task, 2)
        self.assertEqual([queue.pop() for _ in range(3)], ['z-first', 'm-second', 'a-third'])
        self.assertEqual(len(queue), 0)

    def test_fifo_after_remove_then_insert(self):
        queue = TaskQueue()
        queue.add('first', 2)
        queue.add('z-older', 2)
        self.assertEqual(queue.pop(), 'first')
        queue.add('a-new', 2)
        self.assertEqual([queue.pop(), queue.pop()], ['z-older', 'a-new'])
