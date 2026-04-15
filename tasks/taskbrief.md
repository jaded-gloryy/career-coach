Task Brief: Fix F-String Backslash Syntax Error
Problem
Python does not allow backslash escapes inside f-string expressions. This line in base.py is invalid in Python 3.11 and earlier:
pythonyield f"data: {text.replace(chr(10), '\\n')}\n\n"
Fix
Extract the replacement to a variable before the f-string:
pythonsafe_text = text.replace("\n", "\\n")
yield f"data: {safe_text}\n\n"
Apply this pattern anywhere else in base.py where backslashes appear inside f-string expressions.

Success Criteria

Container starts without SyntaxError
docker compose up --build reaches the uvicorn startup log cleanly
