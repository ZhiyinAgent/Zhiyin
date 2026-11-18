"""
What the helpers a script calls did, in words, for the build's answer: an edge
left sharp, a radius made smaller, a belt's length. Each run starts with none.
"""

said = []


def say(text):
    said.append(text)


def forget():
    said.clear()
