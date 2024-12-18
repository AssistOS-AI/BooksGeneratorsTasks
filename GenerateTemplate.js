module.exports = {
    runTask: async function () {
        try {
            const llmModule = await this.loadModule("llm");
            const documentModule = await this.loadModule("document");
            const utilModule = await this.loadModule("util");

            const removeEmptyFields = (obj) => {
                Object.keys(obj).forEach(key => {
                    if (!obj[key]) {
                        delete obj[key];
                    }
                });
                return obj;
            }
            const convertIntFields = (obj) => {
                Object.keys(obj).forEach(key => {
                    if (parseInt(obj[key])) {
                        obj[key] = parseInt(obj[key]);
                    }
                });
                return obj;
            }
            const unsanitizeObj = (obj) => {
                Object.keys(obj).forEach(key => {
                    if (typeof obj[key] === "string") {
                        obj[key] = utilModule.unsanitize(obj[key]);
                    }
                });
                return obj;
            }

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
            const addDocumentTemplate = async (parameters) => {
                const documentObj = {
                    title: `template_${parameters.title}`,
                    abstract: JSON.stringify({
                        ...parameters
                    }),
                };
                return await documentModule.addDocument(this.spaceId, documentObj);
            }

            const createParagraphsPrompt = (generationTemplateStructure, bookData, chapterData) => {
                return `You are a book content manager. Your task is to generate a list of paragraphs based on the user specifications, which will be part of a chapter in a book.

                **Instructions**:
                - Output your response **only** in JSON format matching the following schema:
                ${JSON.stringify(generationTemplateStructure, null, 2)}
                
                - **Do not** include any text outside of the JSON output.
                - Generate **exactly** the number of paragraphs specified in the book data (ideas per chapter).
                - **Ignore any personal biases** toward the number of paragraphs.
                
                **Book Data**:
                ${JSON.stringify(bookData, null, 2)}
                
                **Chapter Data**:
                ${JSON.stringify(chapterData, null, 2)}
                
                Please generate the JSON output now.`;
            };

            const generationTemplateParagraphs = {
                paragraphs: [
                    {
                        "idea": "String"
                    }
                ]
            };

            const getBookChaptersSchema = async () => {
                this.logProgress(`Generating book chapters titles... with prompt:"${bookGenerationPrompt}"`);
                let llmResponse = await llmModule.generateText(this.spaceId, bookGenerationPrompt, this.parameters.personality)
                llmResponse = llmResponse.message
                this.logInfo(`Book chapters schema generated:"${llmResponse}"`);
                const chaptersJsonString = await ensureValidJson(llmResponse, 5);
                return JSON.parse(chaptersJsonString);
            }


            async function generateChapterTemplate(spaceId, prompt, bookData, documentId, chapterId, chapterIndex, chapterTitle, chapterIdea,chapterCount) {
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
                this.logProgress(`Generating paragraphs for chapter ${chapterIndex + 1}/${chapterCount}...with prompt:"${prompt}"`);
                let llmResponse = await llmModule.generateText(spaceId, prompt, this.parameters.personality);
                llmResponse = llmResponse.message
                this.logInfo(`Paragraphs generated for chapter ${chapterIndex + 1}/${chapterCount}:"${llmResponse}"`);
                const paragraphsJsonString = await ensureValidJson(llmResponse, 5);
                const paragraphsData = JSON.parse(paragraphsJsonString);
                this.paragraphIds = [];
                this.logProgress(`Adding paragraphs to the chapter ${chapterIndex + 1}/${chapterCount}...`);
                for (let contor = 0; contor < paragraphsData.paragraphs.length; contor++) {
                    const paragraphObj = {
                        text: paragraphsData.paragraphs[contor].idea,
                    };
                    this.paragraphIds.push(await documentModule.addParagraph(spaceId, documentId, chapterId, paragraphObj));
                    this.logInfo(`Paragraph ${contor + 1} added to the chapter ${chapterIndex + 1}/${chapterCount}`);
                }
                this.logInfo(`All paragraphs added to the chapter ${chapterIndex + 1}/${chapterCount}`);
            }

            this.parameters = removeEmptyFields(this.parameters);
            this.parameters = convertIntFields(this.parameters);
            this.parameters = unsanitizeObj(this.parameters);

            const bookGenerationPrompt = this.parameters["review-prompt"];
            delete this.parameters["review-prompt"];
            const bookData = this.parameters;

            const documentId = await addDocumentTemplate(this.parameters);
            this.logInfo(`Document created with id: ${documentId}`, {documentId: documentId});
            this.logProgress(`Generating titles...`);
            let chapters = await getBookChaptersSchema();
            chapters = chapters.chapters || chapters;

            let chapterIds = []
            this.logProgress(`Adding chapters to the document...`);
            for (const chapter of chapters) {
                chapterIds.push(await documentModule.addChapter(this.spaceId, documentId, chapter));
                this.logInfo(`Chapter ${chapterIds.length - 1} added to the document`);
            }
            this.logInfo(`All chapters added to the document`,);
            let chapterPromises = [];
            for (let index = 0; index < chapters.length; index++) {
                chapterPromises.push((async () => {
                    let retries = 5;
                    const paragraphsPrompt = createParagraphsPrompt(generationTemplateParagraphs, bookData, chapters[index]);
                    while (retries > 0) {
                        try {
                            this.logProgress(`Generating chapter template ${index + 1}/${chapters.length}...`);
                            /* TODO move to a different task and call it when there will be infrastructure to support it */
                            await generateChapterTemplate.call(this, this.spaceId, paragraphsPrompt, bookData, documentId, chapterIds[index], index, chapters[index].title, chapters[index].idea,chapters.length);
                            break;
                        } catch (e) {
                            this.logWarning(`Failed to generate chapter template: ${e.message}`);
                            retries--;
                        }
                    } //fails silently
                    if (retries === 0) {
                        this.logWarning(`Failed to generate chapter template after all retries`, {chapterId: chapterIds[index]});
                        await documentModule.addParagraph(this.parameters.spaceId, documentId, chapterIds[index], {text: "Failed to generate chapter template"});
                    }
                })());
            }
            await Promise.all(chapterPromises);
            this.logSuccess("Finished generating book template", { finished: true});
        } catch (error) {
            this.logError(`Error generating book template: ${error.message}`, {finished: true, error: error});
        }
    },
    cancelTask: async function () {
    },
    serialize: async function () {
    },
    getRelevantInfo: async function () {
    }
}
