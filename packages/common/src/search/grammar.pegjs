{
  const {nodes} = options;
  const span = () => ({text: text(), location: location()});
}

query = _ expression:or_expression? _ { return expression ?? null; }

or_expression
  = first:and_expression rest:(_ or_operator _ next:and_expression { return next; })* {
      return nodes.logical('or', first, rest, span());
    }

and_expression
  = first:unary_expression rest:(and_separator next:unary_expression { return next; })* {
      return nodes.logical('and', first, rest, span());
    }

and_separator = _ and_operator _ / whitespace !and_operator !or_operator

unary_expression
  = negation _ expression:unary_expression { return nodes.not(expression, span()); }
  / primary

primary
  = '(' _ expression:or_expression _ ')' { return nodes.group(expression, span()); }
  / filter

filter
  = key:identifier '[' _ args:filter_arguments? _ ']' {
      return nodes.filter(key, args ?? [], span());
    }

// The first filter argument is positional; later arguments may be named.
filter_arguments
  = first:positional_argument rest:(_ ',' _ arg:argument { return arg; })* {
      return [first, ...rest];
    }

argument = named_argument / positional_argument
named_argument
  = name:identifier ':' _ operator:comparison? _ value:value {
      return nodes.argument(name, operator, value, span());
    }
positional_argument
  = operator:comparison? _ value:value {
      return nodes.argument(null, operator, value, span());
    }

value = function / reference / string
function
  = name:identifier '(' _ args:arguments? _ ')' {
      return nodes.function(name, args ?? [], span());
    }
arguments
  = first:argument rest:(_ ',' _ arg:argument { return arg; })* {
      return [first, ...rest];
    }
reference
  = '@' name:(quoted_string / reference_name) { return nodes.reference(name, span()); }
reference_name
  = value:identifier { return nodes.string([...value], false, span()); }

string = quoted_string / unquoted_string
quoted_string
  = '"' chars:(escape / [^"\\\r\n])* '"' { return nodes.string(chars, true, span()); }
escape
  = '\\' char:["\\*] { return {escaped: char}; }
unquoted_string
  = !'@' chars:[^ \t\r\n()[\],=<>!"\\]+ { return nodes.string(chars, false, span()); }

comparison = '>=' / '<=' / '=' / '>' / '<'
identifier = $([a-zA-Z_] [a-zA-Z0-9_.-]*)
and_operator = 'AND'i ![a-zA-Z0-9_.:\-]
or_operator = 'OR'i ![a-zA-Z0-9_.:\-]
negation = '!'
whitespace = [ \t\r\n]+
_ = [ \t\r\n]*
