"""A small in-memory catalog with exact name lookup."""

ITEMS = {"Notebook": 12, "Pencil": 3, "Desk Lamp": 25}


def lookup(name, *, ignore_case=False):
    """Return the item's price, or None when its exact name is absent."""
    return ITEMS.get(name)
