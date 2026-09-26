// A small JSON reader and writer, so the package needs no other packages.
//
// Parse returns plain .NET values:
//   object  -> Dictionary<string, object>
//   array   -> List<object>
//   string  -> string
//   number  -> double
//   true/false -> bool
//   null    -> null

using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace StoryTools.PhoneWand
{
    public static class Json
    {
        /// <summary>Parse JSON text. Throws FormatException on malformed input.</summary>
        public static object Parse(string text)
        {
            if (text == null) throw new FormatException("JSON text is null.");
            var reader = new Reader(text);
            reader.SkipWhitespace();
            object value = reader.ReadValue();
            reader.SkipWhitespace();
            if (!reader.AtEnd) throw reader.Error("Unexpected text after the JSON value");
            return value;
        }

        /// <summary>Parse JSON text, returning false instead of throwing.</summary>
        public static bool TryParse(string text, out object value)
        {
            try
            {
                value = Parse(text);
                return true;
            }
            catch (FormatException)
            {
                value = null;
                return false;
            }
        }

        /// <summary>
        /// Write a value as compact JSON. Accepts dictionaries with string keys, lists and arrays,
        /// strings, bools, null and any numeric type.
        /// </summary>
        public static string Write(object value)
        {
            var sb = new StringBuilder();
            WriteValue(sb, value);
            return sb.ToString();
        }

        static void WriteValue(StringBuilder sb, object value)
        {
            switch (value)
            {
                case null:
                    sb.Append("null");
                    return;
                case string s:
                    WriteString(sb, s);
                    return;
                case bool b:
                    sb.Append(b ? "true" : "false");
                    return;
                case double d:
                    WriteNumber(sb, d);
                    return;
                case float f:
                    WriteNumber(sb, f);
                    return;
                case int i:
                    sb.Append(i.ToString(CultureInfo.InvariantCulture));
                    return;
                case long l:
                    sb.Append(l.ToString(CultureInfo.InvariantCulture));
                    return;
                case IDictionary<string, object> dict:
                {
                    sb.Append('{');
                    bool first = true;
                    foreach (var kv in dict)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        WriteString(sb, kv.Key);
                        sb.Append(':');
                        WriteValue(sb, kv.Value);
                    }
                    sb.Append('}');
                    return;
                }
                case IEnumerable list:
                {
                    sb.Append('[');
                    bool first = true;
                    foreach (object item in list)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        WriteValue(sb, item);
                    }
                    sb.Append(']');
                    return;
                }
                case IConvertible c:
                    WriteNumber(sb, c.ToDouble(CultureInfo.InvariantCulture));
                    return;
                default:
                    throw new ArgumentException("Json.Write cannot write a " + value.GetType().Name);
            }
        }

        static void WriteNumber(StringBuilder sb, double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d))
            {
                sb.Append("null");
                return;
            }
            sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
        }

        static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20)
                        {
                            sb.Append("\\u");
                            sb.Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append('"');
        }

        sealed class Reader
        {
            readonly string text;
            int pos;

            public Reader(string text)
            {
                this.text = text;
            }

            public bool AtEnd => pos >= text.Length;

            public FormatException Error(string message)
            {
                return new FormatException(message + " at position " + pos + ".");
            }

            public void SkipWhitespace()
            {
                while (pos < text.Length)
                {
                    char c = text[pos];
                    if (c == ' ' || c == '\t' || c == '\n' || c == '\r') pos++;
                    else break;
                }
            }

            public object ReadValue()
            {
                if (AtEnd) throw Error("Unexpected end of JSON");
                char c = text[pos];
                switch (c)
                {
                    case '{': return ReadObject();
                    case '[': return ReadArray();
                    case '"': return ReadString();
                    case 't': Expect("true"); return true;
                    case 'f': Expect("false"); return false;
                    case 'n': Expect("null"); return null;
                    default:
                        if (c == '-' || (c >= '0' && c <= '9')) return ReadNumber();
                        throw Error("Unexpected character '" + c + "'");
                }
            }

            void Expect(string word)
            {
                if (string.CompareOrdinal(text, pos, word, 0, word.Length) != 0) throw Error("Expected " + word);
                pos += word.Length;
            }

            Dictionary<string, object> ReadObject()
            {
                var result = new Dictionary<string, object>();
                pos++; // {
                SkipWhitespace();
                if (pos < text.Length && text[pos] == '}')
                {
                    pos++;
                    return result;
                }
                while (true)
                {
                    SkipWhitespace();
                    if (AtEnd || text[pos] != '"') throw Error("Expected a property name");
                    string key = ReadString();
                    SkipWhitespace();
                    if (AtEnd || text[pos] != ':') throw Error("Expected ':'");
                    pos++;
                    SkipWhitespace();
                    result[key] = ReadValue();
                    SkipWhitespace();
                    if (AtEnd) throw Error("Unterminated object");
                    char c = text[pos++];
                    if (c == '}') return result;
                    if (c != ',') throw Error("Expected ',' or '}'");
                }
            }

            List<object> ReadArray()
            {
                var result = new List<object>();
                pos++; // [
                SkipWhitespace();
                if (pos < text.Length && text[pos] == ']')
                {
                    pos++;
                    return result;
                }
                while (true)
                {
                    SkipWhitespace();
                    result.Add(ReadValue());
                    SkipWhitespace();
                    if (AtEnd) throw Error("Unterminated array");
                    char c = text[pos++];
                    if (c == ']') return result;
                    if (c != ',') throw Error("Expected ',' or ']'");
                }
            }

            string ReadString()
            {
                pos++; // opening quote
                StringBuilder sb = null;
                int start = pos;
                while (true)
                {
                    if (AtEnd) throw Error("Unterminated string");
                    char c = text[pos];
                    if (c == '"')
                    {
                        string result = sb == null
                            ? text.Substring(start, pos - start)
                            : sb.Append(text, start, pos - start).ToString();
                        pos++;
                        return result;
                    }
                    if (c == '\\')
                    {
                        if (sb == null) sb = new StringBuilder();
                        sb.Append(text, start, pos - start);
                        pos++;
                        if (AtEnd) throw Error("Unterminated escape");
                        char e = text[pos++];
                        switch (e)
                        {
                            case '"': sb.Append('"'); break;
                            case '\\': sb.Append('\\'); break;
                            case '/': sb.Append('/'); break;
                            case 'b': sb.Append('\b'); break;
                            case 'f': sb.Append('\f'); break;
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            case 'u':
                                if (pos + 4 > text.Length) throw Error("Bad unicode escape");
                                int code;
                                if (!int.TryParse(text.Substring(pos, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code))
                                    throw Error("Bad unicode escape");
                                sb.Append((char)code);
                                pos += 4;
                                break;
                            default:
                                throw Error("Bad escape '\\" + e + "'");
                        }
                        start = pos;
                        continue;
                    }
                    pos++;
                }
            }

            double ReadNumber()
            {
                int start = pos;
                if (text[pos] == '-') pos++;
                while (pos < text.Length)
                {
                    char c = text[pos];
                    if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') pos++;
                    else break;
                }
                double d;
                if (!double.TryParse(text.Substring(start, pos - start), NumberStyles.Float, CultureInfo.InvariantCulture, out d))
                    throw Error("Bad number");
                return d;
            }
        }
    }
}
