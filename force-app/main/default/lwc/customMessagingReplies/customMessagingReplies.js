import { LightningElement, wire, track, api } from 'lwc'
import { subscribe, APPLICATION_SCOPE, MessageContext } from 'lightning/messageService'
import ConversationEndUserChannel from '@salesforce/messageChannel/lightning__conversationEndUserMessage'
import ConversationAgentSendChannel from '@salesforce/messageChannel/lightning__conversationAgentSend'
import resolvePrompt from '@salesforce/apex/PromptResolutionTemplateController.resolvePrompt'

export default class CustomMessagingReplies extends LightningElement {
	// VARIABLES
	subscription = null
	subscriptionAgent = null

	@track recentMessage = {}
	@track log = []
	@track unansweredMessages = []
	@track showRefine = false
	@track refinement = ''
	@track generating = false
	@track generatedReply = {
		prompt: '',
		response: '',
		source: '',
		time: 0
	}

	@api recordId
	@api contextPromptId
	@api knowledgePromptId
	@api summaryPromptId
	@api refinementPromptId
	@api useCase1PromptName
	@api useCase1PromptId
	@api useCase2PromptName
	@api useCase2PromptId
	@api useCase3PromptName
	@api useCase3PromptId

	@wire(MessageContext) messageContext
	@wire(MessageContext) messageContextAgent

	// GETTERS / SETTERS
	get unreadMsgs() {
		return this.unansweredMessages.length > 0
	}

	get isEmpty() {
		return Object.keys(this.recentMessage).length === 0 || this.unansweredMessages.length === 0
	}

	get genReply() {
		return this.generatedReply.response.length === 0
	}

	get usecasePrompts() {
		return this.usecase1Prompt || this.usecase2Prompt || this.usecase3Prompt
	}

	get usecase1Prompt() {
		if (this.useCase1PromptId && this.useCase1PromptName) {
			return {
				label: `Generate ${this.useCase1PromptName} Reply`,
				key: this.useCase1PromptName,
				id: `${this.useCase1PromptId}`
			}
		}
		return false
	}

	get usecase2Prompt() {
		if (this.useCase2PromptId && this.useCase2PromptName) {
			return {
				label: `Generate ${this.useCase2PromptName} Reply`,
				key: this.useCase2PromptName,
				id: `${this.useCase2PromptId}`
			}
		}
		return false
	}

	get usecase3Prompt() {
		if (this.useCase3PromptId && this.useCase3PromptName) {
			return {
				label: `Generate ${this.useCase3PromptName} Reply`,
				key: this.useCase3PromptName,
				id: `${this.useCase3PromptId}`
			}
		}
		return false
	}

	// LIFECYCLE FUNCTIONS
	connectedCallback() {
		this.subscribeToMessageChannel()
		this.subscribeToAgentMessageChannel()
	}

	// EVENT HANDLERS
	handleMessage(message) {
		this.recentMessage = message
		this.getHistory()
	}

	handleAgentMessage() {
		this.log = []
		this.recentMessage = {}
		this.unansweredMessages = []
		this.generatedReply = {
			prompt: '',
			response: '',
			source: ''
		}
	}

	handleGenerateReply(event) {
		let templateInputs
		let inputsJSON
		let source = event.target.value
		let start = Date.now()
		templateInputs = [
			{ input: 'Messaging_Session', isObject: true, value: this.recordId },
			{ input: 'Content', isObject: false, value: this.unifyAnsweredMessages() }
		]
		inputsJSON = JSON.stringify(templateInputs)
		switch (source) {
			case 'Context':
				this.resolveReplyPrompt(this.contextPromptId, inputsJSON, source, start)
				break
			case 'Summary':
				this.resolveReplyPrompt(this.summaryPromptId, inputsJSON, source, start)
				break
			case 'Knowledge':
				this.resolveReplyPrompt(this.knowledgePromptId, inputsJSON, source, start)
				break
			case this.usecase1Prompt.key:
				this.resolveReplyPrompt(this.usecase1Prompt.id, inputsJSON, source, start)
				break
			case this.usecase2Prompt.key:
				this.resolveReplyPrompt(this.usecase2Prompt.id, inputsJSON, source, start)
				break
			case this.usecase3Prompt.key:
				this.resolveReplyPrompt(this.usecase3Prompt.id, inputsJSON, source, start)
				break
			default:
				console.log('Nothing selected')
		}
	}

	handleShowRefine() {
		let currentShowRf = this.showRefine
		this.showRefine = !currentShowRf
	}

	handleRefinement(event) {
		this.refinement = event.target.value
	}

	handleRefinePrompt() {
		let templateInputs
		let inputsJSON
		templateInputs = [
			{ input: 'Prompt', isObject: false, value: this.generatedReply.prompt },
			{ input: 'Response', isObject: false, value: this.generatedReply.response },
			{ input: 'Refinement', isObject: false, value: this.refinement }
		]
		inputsJSON = JSON.stringify(templateInputs)
		this.generating = true
		let start = Date.now()
		resolvePrompt({ templateId: this.refinementPromptId, templateInputsJSON: inputsJSON })
			.then((data) => {
				let end = Date.now()
				this.generatedReply.response = data.response
				this.generatedReply.prompt = data.prompt
				this.generatedReply.time = (((end - start) % 60000) / 1000).toFixed(2)
				this.refinement = ''
				this.showRefine = false
				this.generating = false
			})
			.catch((error) => {
				console.log('error', error)
			})
	}

	async handleSetInput() {
		const toolKit = this.refs.lwcToolKitApi
		await toolKit.setAgentInput(this.recordId, { text: this.generatedReply.response })
	}

	async handleSendReply() {
		const toolKit = this.refs.lwcToolKitApi
		await toolKit.sendTextMessage(this.recordId, { text: this.generatedReply.response })
	}
	// HELPER FUNCTIONS
	subscribeToMessageChannel() {
		if (!this.subscription) {
			this.subscription = subscribe(this.messageContext, ConversationEndUserChannel, (message) => this.handleMessage(message), { scope: APPLICATION_SCOPE })
		}
	}
	subscribeToAgentMessageChannel() {
		if (!this.subscriptionAgent) {
			this.subscriptionAgent = subscribe(this.messageContextAgent, ConversationAgentSendChannel, () => this.handleAgentMessage(), { scope: APPLICATION_SCOPE })
		}
	}

	unifyAnsweredMessages() {
		let unifiedMsgs = ''
		if (this.unansweredMessages.length === 0) {
			unifiedMsgs = '(blank)'
		} else {
			this.unansweredMessages.forEach((msg) => {
				const regex = /[!.?](?:\s+)?$(?<=)/gm
				let lastDigit = msg.content.charAt(msg.length - 1)
				if (!regex.test(lastDigit)) {
					msg.content += '. '
				}
				unifiedMsgs += msg.content
			})
		}
		return unifiedMsgs
	}

	async getHistory() {
		const toolKit = this.refs.lwcToolKitApi
		this.reset()
		let result
		let alog = []
		result = await toolKit.getConversationLog(this.recordId)
		for (let i = 0; i < result.messages.length; i++) {
			let msg = {
				type: result.messages[i].type,
				content: result.messages[i].content,
				name: result.messages[i].name,
				timestamp: result.messages[i].timestamp
			}
			this.log.push(JSON.stringify(msg))
			alog.push(msg)
		}

		let tempMessages = alog.toReversed()
		this.unansweredMessages = this.filterUntilNotFound(tempMessages, 'EndUser').toReversed()
	}

	reset() {
		this.log = []
	}

	filterUntilNotFound(array, targetValue) {
		var result = []
		for (let i = 0; i < array.length; i++) {
			if (array[i].type === targetValue) {
				result.push(array[i])
			} else {
				break
			}
		}
		return result
	}

	resolveReplyPrompt(template, input, source, start) {
		this.generating = true
		resolvePrompt({ templateId: template, templateInputsJSON: input })
			.then((data) => {
				let end = Date.now()
				this.generatedReply = {
					prompt: data.prompt,
					response: data.response,
					source: source,
					time: (((end - start) % 60000) / 1000).toFixed(2)
				}
				this.generating = false
			})
			.catch((error) => {
				console.log('error', error)
			})
	}
}
