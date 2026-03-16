/**
 * SoT Flow Syntax Highlighter
 * A lightweight regex-based highlighter for .flow DSL
 */
window.FlowHighlighter = {
  highlight(code) {
    if (!code) return "";
    
    // Escape HTML first
    let escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

    const rules = [
      // Comments (%% or //)
      { pattern: /%%.*$|\/\/.*$/gm, class: "flow-comment" },
      
      // Keywords
      { pattern: /\b(include|extern|type|interface|web|docker|Rollup|cliscripts|pkg|main)\b/g, class: "flow-keyword" },
      
      // Arrows/Operators
      { pattern: /-&gt;|---&gt;|---\|&gt;/g, class: "flow-operator" },
      
      // Decorators/Modifiers
      { pattern: /@async\b/g, class: "flow-modifier" },
      
      // Class/Method markers
      { pattern: /@{1,2}[\w.]+(\.code|\.end)/g, class: "flow-block-marker" },
      { pattern: /@\w+\.[\w]+/g, class: "flow-method-sig" },
      
      // Parentheses/Braces
      { pattern: /[{}()\[\]]/g, class: "flow-punctuation" },
      
      // Strings
      { pattern: /&quot;.*?&quot;|&#039;.*?&#039;/g, class: "flow-string" },
      
      // Numbers
      { pattern: /\b\d+\b/g, class: "flow-number" }
    ];

    let highlighted = escaped;
    
    // We need to apply rules carefully to avoid overlapping. 
    // For a simple highlighter, we'll use a placeholder technique or just order them.
    // Order matters: comments first, then blocks, keywords, etc.
    
    // Apply rules. We use $& (or $0 in some contexts, but $& is the standard for "entire match")
    // to wrap the entire matched string in a span.
    rules.forEach(rule => {
      highlighted = highlighted.replace(rule.pattern, `<span class="${rule.class}">$&</span>`);
    });

    return highlighted;
  }
};
