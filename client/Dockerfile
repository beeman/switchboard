FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html app.js libopus.js config.js /usr/share/nginx/html/
COPY docker-entrypoint.sh /switchboard-entrypoint.sh
RUN chmod +x /switchboard-entrypoint.sh
ENTRYPOINT ["/switchboard-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
