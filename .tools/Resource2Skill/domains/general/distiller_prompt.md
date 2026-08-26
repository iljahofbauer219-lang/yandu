# General knowledge distillation

Convert the source into one reusable and actionable knowledge skill.

Requirements:

1. Use only claims explicitly supported by the source.
2. Cite source timestamps after every extracted principle or example.
3. Separate direct evidence, inference, and transcription uncertainty.
4. Do not infer visuals, user interfaces, tools, or actions that are not stated.
5. Return Markdown sections: Purpose, Inputs, Principles with evidence, Step-by-step application, Decision rules, Failure modes, Verification checklist, Source limitations.
6. Do not output implementation code unless the source explicitly teaches code.
