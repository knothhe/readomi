// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { isCustomForceBlockTranslation } from "../filter"

function setHost(host: string) {
  // jsdom exposes location as read-only; override via defineProperty
  Object.defineProperty(window, "location", {
    value: new URL(`https://${host}/some/path`),
    writable: true,
  })
}

describe("isCustomForceBlockTranslation", () => {
  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("matches task-lists element on github.com", () => {
    setHost("github.com")

    const taskLists = document.createElement("task-lists")
    document.body.appendChild(taskLists)

    expect(isCustomForceBlockTranslation(taskLists)).toBe(true)
  })

  it("does not match on non-configured host", () => {
    setHost("example.com")

    const taskLists = document.createElement("task-lists")
    document.body.appendChild(taskLists)

    expect(isCustomForceBlockTranslation(taskLists)).toBe(false)
  })

  it("matches shreddit-post-text-body element on www.reddit.com", () => {
    setHost("www.reddit.com")

    const postTextBody = document.createElement("shreddit-post-text-body")
    document.body.appendChild(postTextBody)

    expect(isCustomForceBlockTranslation(postTextBody)).toBe(true)
  })

  it("does not match element outside configured parent on configured host", () => {
    setHost("github.com")

    const other = document.createElement("div")
    document.body.appendChild(other)

    expect(isCustomForceBlockTranslation(other)).toBe(false)
  })

  it("uses hostname when host includes port", () => {
    setHost("github.com:3000")

    const taskLists = document.createElement("task-lists")
    document.body.appendChild(taskLists)

    expect(window.location.host).toContain(":")
    expect(window.location.hostname).toBe("github.com")

    expect(isCustomForceBlockTranslation(taskLists)).toBe(true)
  })

  it("does not match on non-configured host when host !== hostname", () => {
    setHost("example.com:8080")

    const taskLists = document.createElement("task-lists")
    document.body.appendChild(taskLists)

    expect(window.location.host).toContain(":")
    expect(window.location.hostname).toBe("example.com")

    expect(isCustomForceBlockTranslation(taskLists)).toBe(false)
  })

  it.each(["x.com", "twitter.com"])("matches the tweet paragraph without splitting its inline children on %s", (host) => {
    setHost(host)
    const tweet = document.createElement("div")
    tweet.dataset.testid = "tweetText"
    tweet.innerHTML = "<span>A tweet with <a href='/linked'>a link</a>.</span>"
    document.body.appendChild(tweet)

    expect(isCustomForceBlockTranslation(tweet)).toBe(true)
    expect(isCustomForceBlockTranslation(tweet.querySelector("span")!)).toBe(false)
    expect(isCustomForceBlockTranslation(tweet.querySelector("a")!)).toBe(false)
    expect(isCustomForceBlockTranslation(document.createElement("span"))).toBe(false)
  })

  it("does not force a tweet-shaped paragraph on another site", () => {
    setHost("example.com")
    const tweet = document.createElement("div")
    tweet.dataset.testid = "tweetText"

    expect(isCustomForceBlockTranslation(tweet)).toBe(false)
  })
})
