module.exports = {
    runTask: async function () {
        try {
            const llmModule = await this.loadModule("llm");
            const documentModule = await this.loadModule("document");
            const ensureValidJson = async (jsonString, maxIterations = 1, jsonSchema = null, correctExample = null) => {
                const phases = {
                    "RemoveJsonMark": async (jsonString, error) => {
                        if (jsonString.startsWith("```json")) {
                            jsonString = jsonString.slice(7);
                            if (jsonString.endsWith("```")) {
                                jsonString = jsonString.slice(0, -3);
                            }
                        }
                        return jsonString;
                    },
                    "RemoveOutsideJson": async (jsonString, error) => {
                        if (jsonString.includes("```json")) {
                            const parts = jsonString.split("```json");
                            if (parts.length > 1) {
                                jsonString = parts[1];
                                jsonString = jsonString.split("```")[0];
                            }
                        }
                        return jsonString;
                    },
                    "RemoveNewLine": async (jsonString, error) => {
                        return jsonString.replace(/\n/g, "");
                    },
                    "TrimSpaces": async (jsonString, error) => {
                        return jsonString.trim();
                    },
                    "LlmHelper": async (jsonString, error) => {
                        let prompt;
                        if (!jsonSchema) {
                            prompt = `
                             ** Role:**
                               - You are a global expert in correcting an invalid JSON string to a valid JSON string that is parsable by a JSON parser
                             ** Instructions:**
                                - You will be provided with an invalid JSON string that needs to be corrected.
                                - You will be provided with an error message given by the parser that will help you identify the issue in the JSON string.
                             ** Input JSON string that needs to be corrected:**
                             "${jsonString}"
                             
                             ** Error message given by the parser:**
                                "${error.message}"
                             **Output Specifications:**
                                 - Provide the corrected JSON string that is valid and parsable by a JSON parser.
                                 - Your answer should not include any code block markers (e.g., \`\`\`json).
                                - Your answer should not include additional text, information, metadata or meta-commentary
                            `;
                        } else {
                            prompt = `
                             ** Role:**
                               - You are a global expert in correcting an invalid JSON string to a valid JSON string that is parsable by a JSON parser
                             ** Instructions:**
                                - You will be provided with an invalid JSON string that needs to be corrected.
                                - You will be provided with an error message given by the parser that will help you identify the issue in the JSON string.
                                - You will be provided with a JSON schema that the corrected JSON string should adhere to.
                                ${correctExample ? `- You will be provided with an example of a correct JSON string that adheres to the schema` : ""}
                             
                             ** Input JSON string that needs to be corrected:**
                             "${jsonString}"
                             
                             ** Error message given by the parser:**
                                "${error.message}"
                                ** JSON Schema Template:**
                                "${jsonSchema}"
                                
                                ${correctExample ? `** Example of a correct JSON string that adheres to the schema:**\n"${correctExample}"\n` : ""}
                             **Output Specifications:**
                                 - Provide the corrected JSON string that is valid and parsable by a JSON parser.
                                 - Your answer should not include any code block markers (e.g., \`\`\`json).
                                - Your answer should not include additional text, information, metadata or meta-commentary
                            `;
                        }

                        const response = await llmModule.generateText(this.spaceId, prompt, this.parameters.personality);
                        return response.message;
                    }
                };

                const phaseFunctions = Object.values(phases);

                while (maxIterations > 0) {
                    for (const phase of phaseFunctions) {
                        try {
                            JSON.parse(jsonString);
                            return jsonString;
                        } catch (error) {
                            jsonString = await phase(jsonString, error);
                        }
                    }
                    maxIterations--;
                }
                throw new Error("Unable to ensure valid JSON after all phases.");
            };

            this.logProgress(`Loading template book document: ${this.parameters.documentId}...`);
            const templateDocument = await documentModule.getDocument(this.spaceId, this.parameters.documentId);
            this.logInfo(`Template Book Document Loaded:${templateDocument.title}`);

            let bookDocument = {
                title: templateDocument.title.replace("template_", "book_"),
                abstract: templateDocument.abstract,
            }

            const documentId = await documentModule.addDocument(this.spaceId, bookDocument);
            this.logInfo(`Book Document Created with ID: ${documentId}`, {documentId: documentId});

            const retryAsync = async (fn, retries = 3, delay = 2000) => {
                for (let attempt = 1; attempt <= retries; attempt++) {
                    try {
                        return await fn();
                    } catch (error) {
                        if (attempt < retries) {
                            this.logWarning(`Attempt ${attempt} failed for function ${fn.name}. Retrying in ${delay}ms. Error: ${error.message}`);
                        } else {
                            this.logError(`All ${retries} attempts failed for function ${fn.name}. Error: ${error.message}`);
                            throw error;
                        }
                    }
                }
            };

            class TaskQueue {
                constructor(concurrency) {
                    this.concurrency = concurrency;
                    this.running = 0;
                    this.taskQueue = [];
                    this.resolveIdle = null;
                }

                pushTask(task) {
                    this.taskQueue.push(task);
                    this.next();
                }

                async next() {
                    if (this.running >= this.concurrency || this.taskQueue.length === 0) {
                        if (this.running === 0 && this.taskQueue.length === 0 && this.resolveIdle) {
                            this.resolveIdle();
                        }
                        return;
                    }
                    const task = this.taskQueue.shift();
                    this.running++;
                    try {
                        await task();
                    } catch (err) {
                        console.error('Task error:', err);
                    } finally {
                        this.running--;
                        this.next();
                    }
                }

                onIdle() {
                    return new Promise(resolve => {
                        if (this.running === 0 && this.taskQueue.length === 0) {
                            resolve();
                        } else {
                            this.resolveIdle = resolve;
                        }
                    });
                }
            }

            async function expandParagraph(documentId, chapterId, paragraphId, chapterIndex, paragraphIndex, totalParagraphs, totalChapters, bookData, chapterData, paragraphIdea) {
                const paragraphSchema = {
                    text: "String"
                };
                const llmModule = await this.loadModule("llm");
                const documentModule = await this.loadModule("document");
                const ensureValidJson = async (jsonString, maxIterations = 1, jsonSchema = null, correctExample = null) => {
                    const phases = {
                        "RemoveJsonMark": async (jsonString, error) => {
                            if (jsonString.startsWith("```json")) {
                                jsonString = jsonString.slice(7);
                                if (jsonString.endsWith("```")) {
                                    jsonString = jsonString.slice(0, -3);
                                }
                            }
                            return jsonString;
                        },
                        "RemoveOutsideJson": async (jsonString, error) => {
                            if (jsonString.includes("```json")) {
                                const parts = jsonString.split("```json");
                                if (parts.length > 1) {
                                    jsonString = parts[1];
                                    jsonString = jsonString.split("```")[0];
                                }
                            }
                            return jsonString;
                        },
                        "RemoveNewLine": async (jsonString, error) => {
                            return jsonString.replace(/\n/g, "");
                        },
                        "TrimSpaces": async (jsonString, error) => {
                            return jsonString.trim();
                        },
                        "LlmHelper": async (jsonString, error) => {
                            let prompt;
                            if (!jsonSchema) {
                                prompt = `
                             ** Role:**
                               - You are a global expert in correcting an invalid JSON string to a valid JSON string that is parsable by a JSON parser
                             ** Instructions:**
                                - You will be provided with an invalid JSON string that needs to be corrected.
                                - You will be provided with an error message given by the parser that will help you identify the issue in the JSON string.
                             ** Input JSON string that needs to be corrected:**
                             "${jsonString}"
                             
                             ** Error message given by the parser:**
                                "${error.message}"
                             **Output Specifications:**
                                 - Provide the corrected JSON string that is valid and parsable by a JSON parser.
                                 - Your answer should not include any code block markers (e.g., \`\`\`json).
                                - Your answer should not include additional text, information, metadata or meta-commentary
                            `;
                            } else {
                                prompt = `
                             ** Role:**
                               - You are a global expert in correcting an invalid JSON string to a valid JSON string that is parsable by a JSON parser
                             ** Instructions:**
                                - You will be provided with an invalid JSON string that needs to be corrected.
                                - You will be provided with an error message given by the parser that will help you identify the issue in the JSON string.
                                - You will be provided with a JSON schema that the corrected JSON string should adhere to.
                                ${correctExample ? `- You will be provided with an example of a correct JSON string that adheres to the schema` : ""}
                             
                             ** Input JSON string that needs to be corrected:**
                             "${jsonString}"
                             
                             ** Error message given by the parser:**
                                "${error.message}"
                                ** JSON Schema Template:**
                                "${jsonSchema}"
                                
                                ${correctExample ? `** Example of a correct JSON string that adheres to the schema:**\n"${correctExample}"\n` : ""}
                             **Output Specifications:**
                                 - Provide the corrected JSON string that is valid and parsable by a JSON parser.
                                 - Your answer should not include any code block markers (e.g., \`\`\`json).
                                - Your answer should not include additional text, information, metadata or meta-commentary
                            `;
                            }

                            const response = await llmModule.generateText(this.spaceId, prompt, this.parameters.personality);
                            return response.message;
                        }
                    };

                    const phaseFunctions = Object.values(phases);

                    while (maxIterations > 0) {
                        for (const phase of phaseFunctions) {
                            try {
                                JSON.parse(jsonString);
                                return jsonString;
                            } catch (error) {
                                jsonString = await phase(jsonString, error);
                            }
                        }
                        maxIterations--;
                    }
                    throw new Error("Unable to ensure valid JSON after all phases.");
                };

                const createParagraphPrompt = (bookData, chapterData, paragraphIdea) => {
                    const base = `You are a book content manager. Your task is to write a comprehensive and detailed paragraph that will be part of a chapter in a book.`;

                    const instructions = `
                **Instructions**:
                - Output your response **only** in JSON format matching the following schema:
                ${JSON.stringify(paragraphSchema, null, 2)}
                - **Do not** include any text outside of the JSON output.
                - The paragraph should expand on the given idea.
                
                **Book Details**:
                ${JSON.stringify(bookData, null, 2)}
                
                **Chapter Details**:
                "${JSON.stringify({chapterTitle: chapterData.title, chapterIdea: chapterData.idea}, null, 2)}"
                
                **Paragraph Idea**:
                "${paragraphIdea}"
                
                Please generate the JSON output now.`;

                    return [base, instructions].join("\n");
                };

                const paragraphGenerationPrompt = createParagraphPrompt(
                    bookData,
                    chapterData,
                    paragraphIdea
                );
                this.logProgress(`Generating paragraph ${paragraphIndex + 1}/${totalParagraphs} in chapter ${chapterIndex + 1}/${totalChapters}... with Prompt: "${paragraphGenerationPrompt}"`);
                let response = await llmModule.generateText(this.spaceId, paragraphGenerationPrompt, this.parameters.personality);
                response = response.message
                this.logInfo(`Generated Paragraph ${paragraphIndex + 1}/${totalParagraphs} in chapter ${chapterIndex + 1}/${totalChapters}:${response}`);

                let paragraphJsonString;
                try {
                    paragraphJsonString = await ensureValidJson(response, 1, paragraphSchema);
                } catch (error) {
                    this.logWarning(`Error while ensuring valid JSON for paragraph:${paragraphIndex}/${totalParagraphs} chapter:${chapterIndex}/${totalChapters}. Attempting to regenerate. Error: ${error.message}`);
                    response = await llmModule.generateText(this.spaceId, paragraphGenerationPrompt, this.parameters.personality);
                    paragraphJsonString = await ensureValidJson(response, 2);
                }

                const paragraphGenerated = JSON.parse(paragraphJsonString);

                paragraphGenerated.id = paragraphId;
                this.logProgress(`Updating paragraph ${paragraphIndex + 1}/${totalParagraphs} in chapter ${chapterIndex + 1}/${totalChapters}...`);
                await documentModule.updateParagraph(this.spaceId, documentId, paragraphId, paragraphGenerated);
                this.logInfo(`Successfully expanded paragraph ${paragraphIndex + 1}/${totalParagraphs} in chapter ${chapterIndex + 1}/${totalChapters}`);
            }
            async function refineBook(documentId) {
                try {
                    const llmModule = await this.loadModule('llm');
                    const documentModule = await this.loadModule('document');
                    const utilModule = await this.loadModule('util');

                    const retryAsync = async (fn, retries = 3, delay = 2000) => {
                        for (let attempt = 1; attempt <= retries; attempt++) {
                            try {
                                return await fn();
                            } catch (error) {
                                this.logWarning(`Attempt ${attempt}/${retries} failed with error: ${error.message}`);
                                if (attempt < retries) {
                                    this.logWarning(`Retrying in ${delay}ms...`);
                                    await new Promise(resolve => setTimeout(resolve, delay));
                                } else {
                                    this.logWarning(`All ${retries} attempts failed. Aborting...`);
                                    return null;
                                }
                            }
                        }
                    };
                    const ensureValidJson = async (jsonString, maxIterations = 1, jsonSchema = null, correctExample = null) => {
                        const phases = {
                            "RemoveJsonMark": async (jsonString, error) => {
                                if (jsonString.startsWith("```json")) {
                                    jsonString = jsonString.slice(7);
                                    if (jsonString.endsWith("```")) {
                                        jsonString = jsonString.slice(0, -3);
                                    }
                                }
                                return jsonString;
                            },
                            "RemoveOutsideJson": async (jsonString, error) => {
                                if (jsonString.includes("```json")) {
                                    const parts = jsonString.split("```json");
                                    if (parts.length > 1) {
                                        jsonString = parts[1];
                                        jsonString = jsonString.split("```")[0];
                                    }
                                }
                                return jsonString;
                            },
                            "RemoveNewLine": async (jsonString, error) => {
                                return jsonString.replace(/\n/g, "");
                            },
                            "TrimSpaces": async (jsonString, error) => {
                                return jsonString.trim();
                            },
                            "LlmHelper": async (jsonString, error) => {
                                let prompt;
                                if (!jsonSchema) {
                                    prompt = `
                             ** Role:**
                               - You are a global expert in correcting an invalid JSON string to a valid JSON string that is parsable by a JSON parser
                             ** Instructions:**
                                - You will be provided with an invalid JSON string that needs to be corrected.
                                - You will be provided with an error message given by the parser that will help you identify the issue in the JSON string.
                             ** Input JSON string that needs to be corrected:**
                             "${jsonString}"
                             
                             ** Error message given by the parser:**
                                "${error.message}"
                             **Output Specifications:**
                                 - Provide the corrected JSON string that is valid and parsable by a JSON parser.
                                 - Your answer should not include any code block markers (e.g., \`\`\`json).
                                - Your answer should not include additional text, information, metadata or meta-commentary
                            `;
                                } else {
                                    prompt = `
                             ** Role:**
                               - You are a global expert in correcting an invalid JSON string to a valid JSON string that is parsable by a JSON parser
                             ** Instructions:**
                                - You will be provided with an invalid JSON string that needs to be corrected.
                                - You will be provided with an error message given by the parser that will help you identify the issue in the JSON string.
                                - You will be provided with a JSON schema that the corrected JSON string should adhere to.
                                ${correctExample ? `- You will be provided with an example of a correct JSON string that adheres to the schema` : ""}
                             
                             ** Input JSON string that needs to be corrected:**
                             "${jsonString}"
                             
                             ** Error message given by the parser:**
                                "${error.message}"
                                ** JSON Schema Template:**
                                "${jsonSchema}"
                                
                                ${correctExample ? `** Example of a correct JSON string that adheres to the schema:**\n"${correctExample}"\n` : ""}
                             **Output Specifications:**
                                 - Provide the corrected JSON string that is valid and parsable by a JSON parser.
                                 - Your answer should not include any code block markers (e.g., \`\`\`json).
                                - Your answer should not include additional text, information, metadata or meta-commentary
                            `;
                                }

                                const response = await llmModule.generateText(this.spaceId, prompt, this.parameters.personality);
                                return response.message;
                            }
                        };

                        const phaseFunctions = Object.values(phases);

                        while (maxIterations > 0) {
                            for (const phase of phaseFunctions) {
                                try {
                                    JSON.parse(jsonString);
                                    return jsonString;
                                } catch (error) {
                                    jsonString = await phase(jsonString, error);
                                }
                            }
                            maxIterations--;
                        }
                        throw new Error("Unable to ensure valid JSON after all phases.");
                    };
                    const paragraphSchema = {"text": "String"};

                    const Algorithms = {
                        // Rafinare de context intre chunk-uri de paragrafe -> Asigura coerenta si fluiditate intre paragrafe
                        proceduralRefinement: async (book) => {
                            const generateAndSendRequest = async (prompt, paragraph, chapter, book) => {
                                let response = await retryAsync(async () => {
                                    return await llmModule.generateText(this.spaceId, prompt, this.parameters.personality);
                                });
                                response = response.message
                                if (response) {
                                    let generatedParagraph = await ensureValidJson(response, 3, paragraphSchema);
                                    generatedParagraph = JSON.parse(generatedParagraph);
                                    await documentModule.updateParagraphText(this.spaceId, book.id, paragraph.id, generatedParagraph.text);
                                    paragraph.text = generatedParagraph.text; //update the local paragraph object
                                } else {
                                    this.logWarning(`Failed to refine paragraph ID: ${paragraph.id} in chapter ID: ${chapter.id}. Skipping this paragraph.`);
                                }
                            };

                            const treatFirstParagraph = async (currentParagraph, currentChapter, book) => {
                                const generateRefinementPrompt = () => {
                                    return `
                                    You are a book content manager. Your task is to refactor the current paragraph to blend seamlessly with the flow and content of the book and the chapter.
                                    
                                    **Instructions**:
                                    - Output your response **only** in JSON format matching the following schema:
                                    ${JSON.stringify(paragraphSchema, null, 2)}
                                    - **Do not** include any text outside of the JSON output.
                                    - Ensure the paragraph connects logically with the chapter and book content.
                                    
                                    **Book Abstract**:
                                    "${book.abstract}"
                                    
                                    **Chapter Details**:
                                    {
                                      "title": "${currentChapter.title}",
                                      "idea": "${currentChapter.idea}"
                                    }
                                    
                                    **Current Paragraph**:
                                    "${currentParagraph.text}"
                                    
                                    Please generate the refined paragraph in JSON format now.`;
                                };
                                const generationPrompt = generateRefinementPrompt();
                                this.logProgress(`Refining first paragraph in chapter ${currentChapter.title}...with prompt:"${generationPrompt}"`);
                                await generateAndSendRequest(generationPrompt, currentParagraph, currentChapter, book);
                            };

                            const treatLastParagraph = async (currentParagraph, previousParagraph, currentChapter, book) => {
                                const generateRefinementPrompt = () => {
                                    return `
                                    You are a book content manager. Your task is to refactor the current paragraph to blend seamlessly with the flow and content of the book and the chapter.
                                    
                                    **Instructions**:
                                    - Output your response **only** in JSON format matching the following schema:
                                    ${JSON.stringify(paragraphSchema, null, 2)}
                                    - **Do not** include any text outside of the JSON output.
                                    - Ensure the paragraph connects logically with the chapter and book content.
                                    
                                    **Book Abstract**:
                                    "${book.abstract}"
                                    
                                    **Chapter Details**:
                                    {
                                      "title": "${currentChapter.title}",
                                      "idea": "${currentChapter.idea}"
                                    }
                                    
                                    **Previous Paragraph**:
                                    "${previousParagraph.text}"
                                    
                                    **Current Paragraph**:
                                    "${currentParagraph.text}"
                                    
                                    Please generate the refined paragraph in JSON format now.`;
                                };
                                const generationPrompt = generateRefinementPrompt();
                                this.logProgress(`Refining last paragraph in chapter ${currentChapter.title}... with prompt:"${generationPrompt}"`);
                                await generateAndSendRequest(generationPrompt, currentParagraph, currentChapter, book);
                            };

                            const treatMiddleParagraph = async (currentParagraph, previousParagraph, nextParagraph, currentChapter, book) => {
                                const generateRefinementPrompt = () => {
                                    return `
                                    You are a book content manager. Your task is to refactor the current paragraph to blend seamlessly with the flow and content of the book and the chapter.
                                    
                                    **Instructions**:
                                    - Output your response **only** in JSON format matching the following schema:
                                    ${JSON.stringify(paragraphSchema, null, 2)}
                                    - **Do not** include any text outside of the JSON output.
                                    - Ensure the paragraph connects logically with the surrounding paragraphs, chapter, and book content.
                                    
                                    **Book Abstract**:
                                    "${book.abstract}"
                                    
                                    **Chapter Details**:
                                    {
                                      "title": "${currentChapter.title}",
                                      "idea": "${currentChapter.idea}"
                                    }
                                    
                                    **Previous Paragraph**:
                                    "${previousParagraph.text}"
                                    
                                    **Current Paragraph**:
                                    "${currentParagraph.text}"
                                    
                                    **Next Paragraph**:
                                    "${nextParagraph.text}"
                                    
                                    Please generate the refined paragraph in JSON format now.`;
                                };
                                const generationPrompt = generateRefinementPrompt();
                                this.logProgress(`Refining middle paragraph in chapter ${currentChapter.title}... with prompt:"${generationPrompt}"`);
                                await generateAndSendRequest(generationPrompt, currentParagraph, currentChapter, book);
                            };

                            const chapters = book.chapters;
                            book.abstract = utilModule.unsanitize(book.abstract);

                            for (const [chapterIndex, chapter] of chapters.entries()) {
                                for (const [paragraphIndex, paragraph] of chapter.paragraphs.entries()) {
                                    this.logProgress(`Applying procedural refinement to paragraph ${paragraphIndex + 1}/${chapter.paragraphs.length} in chapter ${chapterIndex + 1}/${chapters.length}...`);
                                    try {
                                        if (chapter.paragraphs.length === 1) {
                                            await treatFirstParagraph(paragraph, chapter, book);
                                        } else if (paragraphIndex === 0) {
                                            await treatFirstParagraph(paragraph, chapter, book);
                                        } else if (paragraphIndex === chapter.paragraphs.length - 1) {
                                            await treatLastParagraph(paragraph, chapter.paragraphs[paragraphIndex - 1], chapter, book);
                                        } else {
                                            await treatMiddleParagraph(
                                                paragraph,
                                                chapter.paragraphs[paragraphIndex - 1],
                                                chapter.paragraphs[paragraphIndex + 1],
                                                chapter,
                                                book
                                            );
                                        }
                                        this.logInfo(`Successfully applied procedural refinement to paragraph ${paragraphIndex + 1}/${chapter.paragraphs.length} in chapter ${chapterIndex + 1}/${chapters.length}.`);
                                    } catch (error) {
                                        this.logWarning(`Error while refining paragraph:${paragraphIndex + 1}/${chapter.paragraphs.length} in chapter ${chapterIndex + 1}/${chapters.length}. Error: ${error.message}. Proceeding with the original paragraph.`);
                                    }
                                }


                            }
                        },
                        // Rafinare de tranzitie intre paragrafe
                        transitionEnhancer: async (book) => {
                            const generateAndSendRequest = async (prompt, paragraph, previousParagraph, chapter) => {
                                let response = await retryAsync(async () => {
                                    return await llmModule.generateText(this.spaceId, prompt, this.parameters.personality);
                                });
                                if (!response) {
                                    this.logWarning(`Failed to refine paragraph ID: ${paragraph.id} in chapter ID: ${chapter.id}. Skipping this paragraph.`);
                                    return;
                                }
                                response = response.message
                                let generatedParagraph = await ensureValidJson(response, 3, paragraphSchema);
                                generatedParagraph = JSON.parse(generatedParagraph);
                                await documentModule.updateParagraphText(this.spaceId, book.id, paragraph.id, generatedParagraph.text);
                                paragraph.text = generatedParagraph.text;

                            };

                            for (const chapter of book.chapters) {
                                for (let i = 0; i < chapter.paragraphs.length; i++) {
                                    this.logProgress(`Applying transition enhancement to paragraph ${i + 1}/${chapter.paragraphs.length} in chapter ${chapter.title}...`);
                                    try {
                                        const paragraph = chapter.paragraphs[i];
                                        const previousParagraph = i > 0 ? chapter.paragraphs[i - 1] : null;

                                        const prompt = `
                                    You are an editor improving transitions between paragraphs.
                                
                                    **Instructions**:
                                    - If applicable, adjust the beginning of the current paragraph to connect smoothly with the previous paragraph.
                                    - Ensure logical progression and coherent flow.
                                    - Output your response **only** in JSON format matching the following schema:
                                    ${JSON.stringify(paragraphSchema, null, 2)}
                                    - **Do not** include any text outside of the JSON output.
                                
                                    ${previousParagraph ? `**Previous Paragraph**:\n"${previousParagraph.text}"` : ''}
                                    **Current Paragraph**:
                                    "${paragraph.text}"
                                
                                    Please provide the refined paragraph in JSON format now.`;
                                        await generateAndSendRequest(prompt, paragraph, previousParagraph, chapter);
                                    } catch (error) {
                                        this.logWarning(`Error while refining paragraph:${i + 1}/${chapter.paragraphs.length} in chapter ${chapter.title}. Error: ${error.message}. Proceeding with the original paragraph.`);
                                        continue;
                                    }
                                    this.logInfo(`Successfully applied transition enhancement to paragraph ${i + 1}/${chapter.paragraphs.length} in chapter ${chapter.title}.`);
                                }
                            }
                        },
                        // Rafinare/Corectare de stil dupa personalitatea selectata -> Mentinere unui stil consistent sau pentru a adapta textul la un anumit ton/voce narativa
                        styleCorrection: async (book) => {
                        },
                        // Extindere paragrafe curente -> Imbogatire continut unde este necesar
                        deepParagraphExpansion: async (book) => {
                        },
                        // Adaugare de noi paragrafe in capitole -> acoperirea mai multor sub-teme in capitole
                        deepChapterExpansion: async (book) => {
                        },
                        // Adaugare de noi capitole in carte -> introduce noi teme si subiecte
                        deepBookExpansion: async (book) => {
                        }
                    };

                    const book = await documentModule.getDocument(this.spaceId, documentId);

                    this.logProgress(`Applying procedural refinement to the book...`);
                    await Algorithms.proceduralRefinement(book);
                    this.logInfo(`Successfully applied procedural refinement to the book.`);
                    this.logProgress(`Applying transition enhancement to the book...`);
                    await Algorithms.transitionEnhancer(book);
                    this.logInfo(`Successfully applied transition enhancement to the book.`);
                    this.logProgress(`Applying style correction to the book...`);
                    await Algorithms.styleCorrection(book);
                    this.logInfo(`Successfully applied style correction to the book.`);
                    this.logProgress(`Applying deep paragraph expansion to the book...`);
                    await Algorithms.deepParagraphExpansion(book);
                    this.logInfo(`Successfully applied deep paragraph expansion to the book.`);
                    this.logProgress(`Applying deep chapter expansion to the book...`);
                    await Algorithms.deepChapterExpansion(book);
                    this.logInfo(`Successfully applied deep chapter expansion to the book.`);
                    this.logProgress(`Applying deep book expansion to the book...`);
                    await Algorithms.deepBookExpansion(book);
                    this.logInfo(`Successfully applied deep book expansion to the book.`);
                } catch (error) {
                    this.logError(`Error while refining book: ${error.message}`);
                    throw error;
                }
            }

            const taskQueue = new TaskQueue(6);

            for (let chapterIndex = 0; chapterIndex < templateDocument.chapters.length; chapterIndex++) {
                const chapterData = {
                    title: templateDocument.chapters[chapterIndex].title,
                    idea: templateDocument.chapters[chapterIndex].idea,
                    paragraphs: []
                };
                const chapterId = await documentModule.addChapter(this.spaceId, documentId, chapterData);

                let paragraphIds = [];

                for (let index = 0; index < templateDocument.chapters[chapterIndex].paragraphs.length; index++) {
                    const paragraphId = await documentModule.addParagraph(this.spaceId, documentId, chapterId, {text: "Preparing for Generation..."});
                    await documentModule.updateParagraphComment(this.spaceId, documentId, paragraphId, templateDocument.chapters[chapterIndex].paragraphs[index].text);
                    paragraphIds.push(paragraphId);
                }

                for (let index = 0; index < paragraphIds.length; index++) {
                    const task = async () => {
                        try {
                            /* TODO move to a different task and call it when there will be infrastructure to support it */
                            await expandParagraph.call(this, documentId, chapterId, paragraphIds[index], chapterIndex, index, paragraphIds.length, templateDocument.chapters.length, bookDocument.abstract, chapterData, templateDocument.chapters[chapterIndex].paragraphs[index].text);
                        } catch (error) {
                            await documentModule.updateParagraph(this.spaceId, documentId, paragraphIds[index], {text: `Error in expanding paragraph:${error.message}`, id: paragraphIds[index]});
                            this.logWarning(`Error while expanding paragraph:${index}/${paragraphIds.length} chapter:${chapterIndex}/${templateDocument.chapters.length}. Error: ${error.message}`);
                        }
                    };
                    taskQueue.pushTask(() => retryAsync(task));
                }
            }
            await taskQueue.onIdle();
            this.logProgress(`Book Generation Completed. Started refining the book...`);
            await refineBook.call(this, documentId);
            this.logProgress(`Book Refinement Completed.`);
            this.logSuccess(`Book Generation and Refinement Completed Successfully. Book ID: ${documentId}`, {
                finished: true
            });
        } catch (error) {
            this.logError(`Encountered an error: ${error.message} while Generating Book`, {
                error: error,
                finished: true
            });
        }
    },
    cancelTask: async function () {
    },
    serialize: async function () {
    },
    getRelevantInfo: async function () {
    }
}
