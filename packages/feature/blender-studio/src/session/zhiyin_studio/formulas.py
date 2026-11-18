"""
Formulas a part follows another by, as text the model writes: checked to be arithmetic and nothing
else, worked out here at a value, and written in Blender's units, whose angles are radians where the
tools' are degrees. Nothing here needs Blender.
"""

import ast
import io
import math
import tokenize

from .errors import Refused

# The name a formula gives the value followed.
FOLLOWED = "v"
SIMPLE = (
    "A formula uses numbers, v, + - * / and brackets, pi, and sin, cos, tan, asin, acos, atan, atan2, sqrt, pow, abs, min, max,"
    " floor, fmod, radians and degrees; write a power as pow(a, b). Angles are degrees, so the sine of v is sin(radians(v))."
)
# What a formula may use, as Blender's own short formulas may: numbers, v, pi and these.
FUNCTIONS = {
    "sin": math.sin, "cos": math.cos, "tan": math.tan, "asin": math.asin, "acos": math.acos,
    "atan": math.atan, "atan2": math.atan2, "sqrt": math.sqrt, "pow": math.pow, "abs": abs,
    "min": min, "max": max, "floor": math.floor, "fmod": math.fmod,
    "radians": math.radians, "degrees": math.degrees,
}


def _need(condition, message):
    if not condition:
        raise Refused(message)


def in_tool_units(expression, angles, to_angle, refusal):
    """
    An expression in the tools' units, as Blender's: each name in `angles` read in degrees, and the
    whole turned to radians when it sets an angle. Refused with `refusal` when it is not Python's
    tokens at all.
    """
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(expression).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        raise Refused(refusal) from None
    written = []
    for token in tokens:
        if token.type == tokenize.NAME and token.string in angles:
            written += [(tokenize.OP, "("), (tokenize.NAME, f"degrees({token.string})"), (tokenize.OP, ")")]
        else:
            written.append((token.type, token.string))
    text = tokenize.untokenize(written).strip()
    return f"radians({text})" if to_angle else text


def worked_out(formula):
    """A formula as a function of v, worked out here; refused as Blender's are when it uses anything else."""
    try:
        tree = ast.parse(formula.strip(), mode="eval")
    except SyntaxError:
        raise Refused(SIMPLE) from None

    def value(node, v):
        if isinstance(node, ast.Expression):
            return value(node.body, v)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return float(node.value)
        if isinstance(node, ast.Name) and node.id in (FOLLOWED, "pi"):
            return v if node.id == FOLLOWED else math.pi
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            inner = value(node.operand, v)
            return -inner if isinstance(node.op, ast.USub) else inner
        if isinstance(node, ast.BinOp):
            a, b = value(node.left, v), value(node.right, v)
            if isinstance(node.op, ast.Add):
                return a + b
            if isinstance(node.op, ast.Sub):
                return a - b
            if isinstance(node.op, ast.Mult):
                return a * b
            return a / b
        return float(FUNCTIONS[node.func.id](*(value(a, v) for a in node.args)))

    # Checked once before any value: a name or an operation it may not use is refused now.
    check(tree.body)
    return lambda v: value(tree, v)


def check(node):
    """Refuses a formula's tree unless it holds numbers, v, pi, + - * /, signs and the FUNCTIONS alone."""
    allowed = (ast.Constant, ast.Name, ast.UnaryOp, ast.BinOp, ast.Call)
    _need(isinstance(node, allowed), SIMPLE)
    if isinstance(node, ast.Constant):
        _need(isinstance(node.value, (int, float)) and not isinstance(node.value, bool), SIMPLE)
    elif isinstance(node, ast.Name):
        _need(node.id in (FOLLOWED, "pi"), SIMPLE)
    elif isinstance(node, ast.UnaryOp):
        _need(isinstance(node.op, (ast.USub, ast.UAdd)), SIMPLE)
        check(node.operand)
    elif isinstance(node, ast.BinOp):
        _need(isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)), SIMPLE)
        check(node.left)
        check(node.right)
    else:
        _need(isinstance(node.func, ast.Name) and node.func.id in FUNCTIONS and not node.keywords, SIMPLE)
        for argument in node.args:
            check(argument)
