import katex from "katex";
import "katex/dist/katex.min.css";

const SYMBOLS = new Map([
  ["TIMES", "\\times"], ["times", "\\times"], ["CDOT", "\\cdot"],
  ["LEQ", "\\le"], ["leq", "\\le"], ["GEQ", "\\ge"], ["geq", "\\ge"],
  ["NEQ", "\\ne"], ["neq", "\\ne"], ["INF", "\\infty"],
  ["PI", "\\pi"], ["ALPHA", "\\alpha"], ["BETA", "\\beta"],
  ["THETA", "\\theta"], ["LAMBDA", "\\lambda"], ["SUM", "\\sum"],
  ["INT", "\\int"], ["RARROW", "\\rightarrow"], ["LARROW", "\\leftarrow"],
  ["PM", "\\pm"], ["DIV", "\\div"], ["IN", "\\in"],
]);

function tokenize(source) {
  return source.match(/[{}_^]|[A-Za-z]+|[0-9]+(?:\.[0-9]+)?|[^\s]/g) || [];
}

function convertTokens(tokens) {
  let position = 0;

  function atom() {
    const token = tokens[position++];
    if (token === undefined) return "";
    if (token === "{") {
      const value = expression("}");
      position += tokens[position] === "}" ? 1 : 0;
      return `{${value}}`;
    }
    if (token.toLowerCase() === "sqrt") {
      return `\\sqrt${atom()}`;
    }
    if (token.toLowerCase() === "root") {
      const index = atom();
      if ((tokens[position] || "").toLowerCase() === "of") position += 1;
      return `\\sqrt[${index.replace(/^\{|\}$/g, "")}]${atom()}`;
    }
    if (token === "LEFT" || token === "RIGHT" || token === "left" || token === "right") {
      return atom();
    }
    if (token === "from" || token === "to") return "";
    return SYMBOLS.get(token) || token;
  }

  function expression(stop) {
    const output = [];
    while (position < tokens.length && tokens[position] !== stop) {
      const token = tokens[position];
      if (token.toLowerCase?.() === "over") {
        position += 1;
        const numerator = output.join(" ");
        const denominator = atom();
        output.length = 0;
        output.push(`\\frac{${numerator}}{${denominator.replace(/^\{|\}$/g, "")}}`);
        continue;
      }
      if (token === "^" || token === "_") {
        position += 1;
        output.push(token + atom());
        continue;
      }
      output.push(atom());
    }
    return output.filter(Boolean).join(" ");
  }

  return expression();
}

export function hwpEquationToLatex(script) {
  const firstLine = (script || "").split(/\r?\n/).find((line) => line.trim()) || "";
  return convertTokens(tokenize(firstLine));
}

export function renderEquation(script, target) {
  const latex = hwpEquationToLatex(script);
  if (!latex) return false;
  target.classList.add("math-expression");
  try {
    katex.render(latex, target, { throwOnError: true, strict: false });
  } catch {
    target.classList.add("math-fallback");
    target.textContent = script.split(/\r?\n/)[0] || "수식";
  }
  return true;
}
