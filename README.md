# Stream LLM

Streaming LLM inference with GPU shards -- split, upload, and run LLMs from the browser.

## Architecture

Colab (convert) -> Download GGUF -> Split into per-layer .bin shards -> Upload to CDN
Server (jumpstart) -> Express + 2 preloaded layers -> Deploy on Render
Browser (WebGPU) -> fetch -> upload -> compute -> evict -> Real-time streaming
