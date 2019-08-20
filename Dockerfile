FROM node:10.16-alpine

# Need to have git since we're installing dependencies from github
RUN apk add --no-cache git

EXPOSE 3000

COPY ./secrets /

WORKDIR /src/

COPY ./src/ /src/

RUN npm install --production

CMD ["node", "/src/index.js"]
