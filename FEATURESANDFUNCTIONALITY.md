# Problem
Learning a new language through immersion (like watching YouTube videos) is highly effective, but traditional methods lack real-time interaction and personalized vocabulary building.

Language learners struggle with:
- Passive consumption of foreign content without active recall
- Context switching between video and translation tools
- Vocabulary revevant to what your interests are

Lack of personalized learning materials from authentic content

# Solution

FluentAI provides users a way to consume content in the language they are learning (currenly working best on romantic languages), in a way that promotes engaging translating and learning vocabulary from content that is relevant or interests you.

# Features

## Translate

Watch videos in the language you are learning and translate the video as you watch it, with feedback provided on each translation.

## FlashCards

Extract vocabulary automatically from youtube videos you are watching to create flash cards to learn words you will actually use.

Flashcards are also are able to be created/edited and deleted manually also.

## Text to Speech

Sometimes you cant quite grasp the pronunciation from areas of a video with poor audio quality so to improve upon just the subtitle translations listen with clear audio on areas you didnt fully comprehend through audio. 

## Customisability

Fully customisable settings allowing you to callibrate the app to best suit you and your needs.

# API Usage

## Goodle Chrome's Inbuilt AI

Writer:
- Content generation for translation evaluation and feedback
- Quiz Generation

Translator: 
- Local fast text translation 
- used to check answers (along with similarity differences, writer API and gemini if required)

Language Detector:
- Used in development to check if transcript which the content was extracted from was in the correct language as well as checking words definitions for similar languages.

# External APIs and Technologies

Gemini:
- Validate translations where the inbuilt translator failed due to limitations usually to do with contextual differences in words as well as a limited downloaded vocabulary database.
- Validate Flashcards.

Web Speech API:
- Text to Speach for assistance with hearing poor audio

IndexedDB:
- bypass kQuotaBytesPerItem and chromes sync limited storage if a user wants to collect a lot of vocabulary

Storage:
- Store settings
