import { type FilterExpr, type FilterQuery, FilterSyntaxError } from '../types'
import { type FilterToken, lexFilter } from './lexer'

class TokenStream {
  private index = 0
  private readonly tokens: FilterToken[]
  private readonly eof: FilterToken

  constructor(tokens: FilterToken[], inputLength: number) {
    this.tokens = tokens
    this.eof = { kind: 'eof', pos: inputLength }
  }

  peek(): FilterToken {
    return this.tokens[this.index] ?? this.eof
  }

  advance(): FilterToken {
    const token = this.peek()
    if (token.kind !== 'eof') this.index += 1
    return token
  }
}

function tokenLabel(token: FilterToken): string {
  switch (token.kind) {
    case 'lparen':
      return "'('"
    case 'rparen':
      return "')'"
    case 'comma':
      return "','"
    case 'and':
      return "'&'"
    case 'or':
      return "'|'"
    case 'not':
      return "'!'"
    case 'predicate':
      return 'expression'
    case 'eof':
      return 'end of query'
  }
}

/** precedence: `!` > `&` > `|`; `,` splits top-level panes */
function parseOr(ts: TokenStream): FilterExpr {
  const children: FilterExpr[] = [parseAnd(ts)]
  while (ts.peek().kind === 'or') {
    ts.advance()
    children.push(parseAnd(ts))
  }
  const first = children[0]
  return children.length === 1 && first ? first : { t: 'or', children }
}

function parseAnd(ts: TokenStream): FilterExpr {
  const children: FilterExpr[] = [parseUnary(ts)]
  while (ts.peek().kind === 'and') {
    ts.advance()
    children.push(parseUnary(ts))
  }
  const first = children[0]
  return children.length === 1 && first ? first : { t: 'and', children }
}

function parseUnary(ts: TokenStream): FilterExpr {
  const token = ts.peek()
  if (token.kind === 'not') {
    ts.advance()
    return { t: 'not', child: parseUnary(ts) }
  }
  if (token.kind === 'lparen') {
    ts.advance()
    const inner = parseOr(ts)
    const close = ts.peek()
    if (close.kind !== 'rparen') {
      throw new FilterSyntaxError(`expected ')', found ${tokenLabel(close)}`, close.pos)
    }
    ts.advance()
    return inner
  }
  if (token.kind === 'predicate') {
    ts.advance()
    return token.pred
  }
  throw new FilterSyntaxError(`expected an expression, found ${tokenLabel(token)}`, token.pos)
}

/** Parse a filter query into panes (comma-separated) of boolean expressions. */
export function parseFilter(query: string): FilterQuery {
  const ts = new TokenStream(lexFilter(query), query.length)
  const panes: FilterExpr[] = [parseOr(ts)]
  while (ts.peek().kind === 'comma') {
    ts.advance()
    panes.push(parseOr(ts))
  }
  const trailing = ts.peek()
  if (trailing.kind !== 'eof') {
    throw new FilterSyntaxError(`unexpected ${tokenLabel(trailing)}`, trailing.pos)
  }
  return { panes }
}
