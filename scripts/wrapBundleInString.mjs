async function wrapInString() {
  try {
    // Read the bundled file
    const bundleContent = await fs.readFile('dist/webview-bundle.js', 'utf8');

    // Convert the content to a string and assign it to a variable
    // prevent [SyntaxError: 1:1967:non-terminated string]
    const escapedContent = bundleContent.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');;
    const wrappedContent = `const webviewPreloadedJS = \`${escapedContent}\`;\nexport default webviewPreloadedJS;`;    

    // Write the wrapped content to a new JS file
    await fs.writeFile('dist/webview-string.js', wrappedContent, 'utf8');
    console.log('Wrapped bundle.js content in a string and saved to webview-string.js');
  } catch (error) {
    console.error('Error while wrapping bundle in string:', error);
  }
}

wrapInString();
